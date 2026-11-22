import { redirect } from "next/navigation";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { chatId } = await searchParams;
  if (typeof chatId === "string" && /^[\w-]+$/.test(chatId)) {
    redirect(`/c/${chatId}`);
  }
  return null;
}
