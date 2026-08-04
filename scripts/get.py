"""
TIPO 全球專利檢索系統 - 爬蟲 v7

改版：不再下載 PDF
  → 點入「公開公告號」連結進入專利詳細頁
  → 抓取 div.divsum_AB 中的摘要文字

安裝：pip install selenium pandas openpyxl
需要 ChromeDriver：https://chromedriver.chromium.org/
"""

import re
import time
import pandas as pd
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options

# ═══════════════════════════════════════════════════════
#  設定區
# ═══════════════════════════════════════════════════════
KEYWORDS    = ["金控", "保險", "銀行", "壽險", "產險"]
TARGET_URL  = "https://tiponet.tipo.gov.tw/gpss2/gpsskmc/gpssbkm?@@0.09059124356163684"
OUTPUT_FILE = "tipo_patents.xlsx"
WAIT_SEC    = 20
PAGE_DELAY  = 2.5
DETAIL_WAIT = 10      # 等待詳細頁載入秒數
MAX_PAGES   = 30     # 前 10 頁；改 999 可全爬
# ═══════════════════════════════════════════════════════


def init_driver() -> webdriver.Chrome:
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
    return webdriver.Chrome(options=opts)


# ───────────────────────────────────────────────────────
#  進入專利詳細頁，抓 div.divsum_AB 摘要
# ───────────────────────────────────────────────────────
def fetch_abstract_from_detail(driver: webdriver.Chrome, detail_href: str) -> str:
    """
    開新分頁進入詳細頁，抓 div.divsum_AB 的文字，再關回來。
    detail_href：公開公告號 <a> 的 href 屬性（TIPO 內部連結）
    """
    if not detail_href:
        return "[無詳細頁連結]"

    # 組完整 URL
    if detail_href.startswith("/"):
        url = "https://tiponet.tipo.gov.tw" + detail_href
    elif detail_href.startswith("http"):
        url = detail_href
    else:
        url = "https://tiponet.tipo.gov.tw/gpss2/gpsskmc/" + detail_href

    original_window = driver.current_window_handle

    try:
        # 開新分頁
        driver.execute_script("window.open(arguments[0], '_blank');", url)
        # 切換到新分頁
        new_window = [w for w in driver.window_handles if w != original_window][0]
        driver.switch_to.window(new_window)

        wait = WebDriverWait(driver, DETAIL_WAIT)

        # 等待 divsum_AB 出現
        try:
            wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "div.divsum_AB")))
        except Exception:
            return "[詳細頁逾時，找不到 divsum_AB]"

        # 抓摘要（可能有多個，取第一個；通常第一個是中文摘要）
        ab_divs = driver.find_elements(By.CSS_SELECTOR, "div.divsum_AB")
        if not ab_divs:
            return "[找不到 divsum_AB]"

        # 取全部文字（包含中英文）並清理
        abstract = ab_divs[0].text.strip()
        abstract = re.sub(r'\s+', ' ', abstract)
        return abstract[:3000]

    except Exception as e:
        return f"[例外] {e}"
    finally:
        # 關閉新分頁，切回原分頁
        try:
            driver.close()
            driver.switch_to.window(original_window)
        except Exception:
            pass


# ───────────────────────────────────────────────────────
#  爬單一關鍵字
# ───────────────────────────────────────────────────────
def scrape_keyword(driver: webdriver.Chrome, keyword: str) -> list[dict]:
    wait = WebDriverWait(driver, WAIT_SEC)
    driver.get(TARGET_URL)

    try:
        kw_input = wait.until(EC.presence_of_element_located((By.NAME, "_21_1_T")))
        kw_input.clear()
        kw_input.send_keys(keyword)
    except Exception as e:
        print(f"  [錯誤] 找不到輸入框：{e}"); return []

    try:
        driver.find_element(By.NAME, "_IMG_檢索").click()
    except Exception as e:
        print(f"  [錯誤] 找不到檢索按鈕：{e}"); return []

    time.sleep(3)
    records = []
    page_num = 1

    while page_num <= MAX_PAGES:
        try:
            wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "table.sumtab")))
        except Exception:
            print(f"  [{keyword}] 等不到結果，結束。"); break

        rows = driver.find_elements(By.CSS_SELECTOR, "tr.sumtr1")
        print(f"  [{keyword}] 第 {page_num} 頁，共 {len(rows)} 筆", flush=True)
        if not rows:
            break

        page_records = []
        for row in rows:
            try:
                def get_text(css):
                    try: return row.find_element(By.CSS_SELECTOR, css).text.strip()
                    except: return ""

                app_date = get_text("td.sumtd2_AD")
                pub_date = get_text("td.sumtd2_ID")
                app_no   = get_text("td.sumtd2_AN")
                pub_no   = get_text("td.sumtd2_PN")

                title_zh = title_en = ""
                try:
                    lines = [l.strip() for l in row.find_element(
                        By.CSS_SELECTOR, "td.sumtd2_TI div.divsum_TI"
                    ).text.strip().splitlines() if l.strip()]
                    title_zh = lines[0] if lines else ""
                    title_en = lines[1] if len(lines) > 1 else ""
                except: pass

                applicant = ""
                try:
                    pa_parts = [p.strip() for p in row.find_element(
                        By.CSS_SELECTOR, "td.sumtd2_PA"
                    ).text.strip().split(";") if p.strip()]
                    zh_list = [p for p in pa_parts if re.search(r'[\u4e00-\u9fff]', p)]
                    applicant = "；".join(zh_list) if zh_list else (pa_parts[0] if pa_parts else "")
                except: pass

                # 公開公告號的 <a> href（進入詳細頁用）
                detail_href = ""
                try:
                    a_el = row.find_element(By.CSS_SELECTOR, "td.sumtd2_PN a")
                    detail_href = a_el.get_attribute("href") or ""
                except: pass

                if title_zh or app_no:
                    page_records.append({
                        "搜尋關鍵字":   keyword,
                        "申請日":       app_date,
                        "公開公告日":   pub_date,
                        "申請號":       app_no,
                        "公開公告號":   pub_no,
                        "專利名稱(中)": title_zh,
                        "專利名稱(英)": title_en,
                        "申請人":       applicant,
                        "詳細頁連結":   detail_href,
                        "摘要":         "",
                    })
            except Exception as ex:
                print(f"    [列解析錯誤] {ex}")

        # ── 抓完這頁清單後，立刻進詳細頁擷取摘要 ──────
        n = len(page_records)
        for j, rec in enumerate(page_records, 1):
            pub_no = rec["公開公告號"]
            print(f"    摘要 [{j}/{n}] {pub_no} ... ", end="", flush=True)
            abstract = fetch_abstract_from_detail(driver, rec["詳細頁連結"])
            rec["摘要"] = abstract
            if abstract.startswith("["):
                print(f"⚠  {abstract[:60]}")
            else:
                print(f"✓  {abstract[:40]}…")
            time.sleep(0.5)

        records.extend(page_records)

        # 翻頁
        try:
            next_btn = driver.find_element(By.NAME, "_IMG_次頁")
            if next_btn.is_displayed() and next_btn.is_enabled():
                next_btn.click(); time.sleep(PAGE_DELAY); page_num += 1
            else:
                print(f"  [{keyword}] 最後一頁。"); break
        except:
            print(f"  [{keyword}] 找不到次頁，結束。"); break

    return records


def main():
    sep = "═" * 55
    print(sep)
    print("  TIPO 全球專利檢索系統 爬蟲 v7")
    print(sep)

    driver = init_driver()
    all_records: list[dict] = []

    try:
        for kw in KEYWORDS:
            print(f"\n▶ 搜尋關鍵字：【{kw}】")
            recs = scrape_keyword(driver, kw)
            print(f"  → 【{kw}】完成，共 {len(recs)} 筆")
            all_records.extend(recs)
    finally:
        driver.quit()
        print("\n瀏覽器已關閉。")

    # ── 輸出 Excel（請先關閉 tipo_patents.xlsx）────────
    columns = [
        "搜尋關鍵字", "申請日", "公開公告日",
        "申請號", "公開公告號",
        "專利名稱(中)", "專利名稱(英)",
        "申請人", "摘要",
    ]
    df = pd.DataFrame(all_records, columns=columns)
    with pd.ExcelWriter(OUTPUT_FILE, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="專利清單")
        ws = writer.sheets["專利清單"]
        for col_cells in ws.columns:
            max_len = max((len(str(c.value)) if c.value else 0) for c in col_cells)
            ws.column_dimensions[col_cells[0].column_letter].width = min(max_len + 4, 60)

    print(f"\n{sep}")
    print(f"  ✅ 完成！共 {len(df)} 筆")
    print(f"  📄 檔案：{OUTPUT_FILE}")
    print(sep)


if __name__ == "__main__":
    main()