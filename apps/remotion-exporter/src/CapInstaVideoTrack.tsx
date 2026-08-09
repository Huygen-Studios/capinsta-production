import { Video } from "@remotion/media";
import { Sequence } from "remotion";
import type { CapInstaRemotionPropsV1 } from "./contracts";
import { sequencesForProps } from "./contracts";

export function CapInstaVideoTrack({ props }: { props: CapInstaRemotionPropsV1 }) {
	const sources = new Map(props.media.sources.map((source) => [source.id, source]));
	return sequencesForProps(props).map(({ entry, from, durationInFrames, trimBefore, trimAfter }) => {
		const source = sources.get(entry.sourceMediaId)!;
		return (
			<Sequence key={entry.id} from={from} durationInFrames={durationInFrames} name={entry.id}>
				<Video
					src={source.url}
					trimBefore={trimBefore}
					trimAfter={trimAfter}
					playbackRate={entry.playbackRate}
					muted={source.muted || !source.hasAudio}
					requestInit={source.requestInit}
					objectFit="cover"
				/>
			</Sequence>
		);
	});
}
