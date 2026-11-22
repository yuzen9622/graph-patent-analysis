import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
	title: "王老師專利知識圖譜分析平台",
	description: "檢索臺灣專利、匯入 Excel 並分析專利知識圖譜。",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			lang="zh-TW"
			suppressHydrationWarning
			className="h-full antialiased"
			data-type="software"
		>
			<head>
				<meta name="page-type" content="software" />
				<meta name="site-kind" content="software" />

			</head>
			<body className="min-h-full flex flex-col">
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					{children}
					<Toaster position="top-center" />
				</ThemeProvider>
			</body>
		</html>
	);
}
