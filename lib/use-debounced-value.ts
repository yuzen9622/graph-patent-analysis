"use client";

import { useEffect, useState } from "react";

/** 在輸入停止變動一段時間後才提交最新值。 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debouncedValue, setDebouncedValue] = useState(value);

	useEffect(() => {
		const timeout = setTimeout(() => setDebouncedValue(value), delayMs);
		return () => clearTimeout(timeout);
	}, [value, delayMs]);

	return debouncedValue;
}
