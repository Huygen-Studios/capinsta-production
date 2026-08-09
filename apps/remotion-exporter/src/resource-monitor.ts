import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ResourceUsageSummary = {
	coverage: "process-tree" | "container-cgroup" | "node-process-only";
	sampleCount: number;
	peakWorkingSetBytes: number;
	peakWorkingSetMiB: number;
	peakHostCpuPercent: number | null;
	averageHostCpuPercent: number | null;
};

type Sample = { at: number; workingSetBytes: number; cpuSeconds: number; cpuCapacity: number };

const windowsScript = (rootPid: number) => `
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime)
$ids = [System.Collections.Generic.HashSet[uint32]]::new()
[void]$ids.Add([uint32]${rootPid})
do {
  $added = $false
  foreach ($p in $all) {
    if ($ids.Contains([uint32]$p.ParentProcessId) -and $ids.Add([uint32]$p.ProcessId)) { $added = $true }
  }
} while ($added)
$selected = @($all | Where-Object { $ids.Contains([uint32]$_.ProcessId) -and [uint32]$_.ProcessId -ne [uint32]$PID })
$working = ($selected | Measure-Object -Property WorkingSetSize -Sum).Sum
$cpu100ns = (($selected | Measure-Object -Property KernelModeTime -Sum).Sum + ($selected | Measure-Object -Property UserModeTime -Sum).Sum)
@{workingSetBytes=[double]$working;cpuSeconds=[double]$cpu100ns/10000000} | ConvertTo-Json -Compress
`;

async function takeSample(): Promise<{ workingSetBytes: number; cpuSeconds: number; cpuCapacity: number; coverage: ResourceUsageSummary["coverage"] }> {
	if (process.platform === "win32") {
		const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsScript(process.pid)], { timeout: 15_000, maxBuffer: 1024 * 1024 });
		const parsed = JSON.parse(stdout.trim()) as { workingSetBytes: number; cpuSeconds: number };
		return { ...parsed, cpuCapacity: Math.max(1, cpus().length), coverage: "process-tree" };
	}
	if (process.platform === "linux") {
		try {
			const [peak, cpuStat, cpuMax] = await Promise.all([
				readFile("/sys/fs/cgroup/memory.peak", "utf8"),
				readFile("/sys/fs/cgroup/cpu.stat", "utf8"),
				readFile("/sys/fs/cgroup/cpu.max", "utf8"),
			]);
			const usage = /^usage_usec\s+(\d+)$/m.exec(cpuStat);
			const [quota, period] = cpuMax.trim().split(/\s+/);
			const cpuCapacity = quota === "max" ? cpus().length : Number(quota) / Number(period);
			const workingSetBytes = Number(peak.trim());
			if (Number.isFinite(workingSetBytes) && usage && Number.isFinite(cpuCapacity)) {
				return { workingSetBytes, cpuSeconds: Number(usage[1]) / 1_000_000, cpuCapacity: Math.max(1, cpuCapacity), coverage: "container-cgroup" };
			}
		} catch {
			// Fall through when the process is not running in a cgroup v2 container.
		}
	}
	const usage = process.resourceUsage();
	return { workingSetBytes: process.memoryUsage().rss, cpuSeconds: (usage.userCPUTime + usage.systemCPUTime) / 1_000_000, cpuCapacity: Math.max(1, cpus().length), coverage: "node-process-only" };
}

export class ResourceMonitor {
	#samples: Sample[] = [];
	#coverage: ResourceUsageSummary["coverage"] = "node-process-only";
	#timer: ReturnType<typeof setInterval> | null = null;
	#sampling: Promise<void> | null = null;

	async start(intervalMilliseconds = 5_000) {
		await this.#sample();
		this.#timer = setInterval(() => void this.#sample(), intervalMilliseconds);
	}

	async #sample() {
		if (this.#sampling) return this.#sampling;
		this.#sampling = (async () => {
			try {
				const sample = await takeSample();
				this.#coverage = sample.coverage;
				this.#samples.push({ at: performance.now(), workingSetBytes: sample.workingSetBytes, cpuSeconds: sample.cpuSeconds, cpuCapacity: sample.cpuCapacity });
			} catch {
				// Resource telemetry is diagnostic; rendering and output verification remain authoritative.
			} finally {
				this.#sampling = null;
			}
		})();
		return this.#sampling;
	}

	async stop(): Promise<ResourceUsageSummary> {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
		if (this.#sampling) await this.#sampling;
		await this.#sample();
		const cpuRates = this.#samples.slice(1).map((sample, index) => {
			const previous = this.#samples[index];
			const elapsedSeconds = (sample.at - previous.at) / 1000;
			return elapsedSeconds > 0 ? Math.max(0, ((sample.cpuSeconds - previous.cpuSeconds) / elapsedSeconds / sample.cpuCapacity) * 100) : 0;
		});
		const first = this.#samples[0];
		const last = this.#samples.at(-1);
		const elapsedSeconds = first && last ? (last.at - first.at) / 1000 : 0;
		const average = first && last && elapsedSeconds > 0 ? Math.max(0, ((last.cpuSeconds - first.cpuSeconds) / elapsedSeconds / last.cpuCapacity) * 100) : null;
		const rawPeakHostCpuPercent = cpuRates.length ? Math.max(...cpuRates) : null;
		const peakWorkingSetBytes = Math.max(0, ...this.#samples.map((sample) => sample.workingSetBytes));
		return {
			coverage: this.#coverage,
			sampleCount: this.#samples.length,
			peakWorkingSetBytes,
			peakWorkingSetMiB: peakWorkingSetBytes / 1024 / 1024,
			peakHostCpuPercent: rawPeakHostCpuPercent !== null && rawPeakHostCpuPercent <= 100 ? rawPeakHostCpuPercent : null,
			averageHostCpuPercent: average,
		};
	}
}
