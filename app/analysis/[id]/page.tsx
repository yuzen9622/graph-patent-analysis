import { redirect } from "next/navigation";

interface Props {
	params: Promise<{ id: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// 舊格式 /analysis/<id> 連結（含已複製的分享連結）導向新格式 /analysis?id=...
export default async function LegacyAnalysisRedirect({
	params,
	searchParams,
}: Props) {
	const { id } = await params;
	const search = await searchParams;
	const q = new URLSearchParams();
	q.set("id", id);
	for (const [key, value] of Object.entries(search)) {
		if (key === "id") continue;
		if (Array.isArray(value)) for (const v of value) q.append(key, v);
		else if (value !== undefined) q.append(key, value);
	}
	redirect(`/analysis?${q.toString()}`);
}
