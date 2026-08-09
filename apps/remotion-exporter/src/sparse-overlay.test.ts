import { describe, expect, test } from "bun:test";

describe("sparse overlay cadence", () => {
	test("held overlay frames never alter the source timeline cadence", () => {
		const overlay = [0, 0, 2, 2, 4, 4];
		const source = [0, 1, 2, 3, 4, 5];
		expect(source.map((sourceFrame, frame) => `${sourceFrame}+${overlay[frame]}`)).toEqual(["0+0", "1+0", "2+2", "3+2", "4+4", "5+4"]);
	});
});
