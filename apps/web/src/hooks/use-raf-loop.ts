import { useEffect, useRef } from "react";

/**
 * Runs a callback on every animation frame.
 *
 * Uses a stable ref pattern so the loop itself is installed once and
 * always reads the latest callback, avoiding teardown/re-install churn
 * when the callback identity changes (e.g. because deps changed).
 */
export function useRafLoop(callback: ({ time }: { time: number }) => void) {
	const callbackRef = useRef(callback);
	const requestRef = useRef<number>(0);
	const previousTimeRef = useRef<number | null>(null);

	useEffect(() => {
		callbackRef.current = callback;
	}, [callback]);

	useEffect(() => {
		const loop = ({ time }: { time: number }) => {
			if (previousTimeRef.current !== null) {
				const deltaTime = time - previousTimeRef.current;
				callbackRef.current({ time: deltaTime });
			}
			previousTimeRef.current = time;
			requestRef.current = requestAnimationFrame((time) => loop({ time }));
		};

		requestRef.current = requestAnimationFrame((time) => loop({ time }));
		return () => cancelAnimationFrame(requestRef.current);
	}, []);
}
