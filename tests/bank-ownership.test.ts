import { describe, expect, it } from "vitest";
import { bankOwnershipOf } from "../lib/bank-ownership";

const publicBanks = [
  "臺灣銀行", "臺灣土地銀行", "中國輸出入銀行", "合作金庫商業銀行", "第一商業銀行",
  "華南商業銀行", "彰化商業銀行", "兆豐國際商業銀行", "臺灣中小企業銀行", "中央銀行", "全國農業金庫",
];

describe("指定 11 家國營機構", () => {
  it.each(publicBanks)("%s 與公司全名均歸國營", name => {
    expect(bankOwnershipOf(name)).toBe("public");
    expect(bankOwnershipOf(`${name}股份有限公司`)).toBe("public");
    expect(bankOwnershipOf(` ${name.replaceAll("臺", "台")} `)).toBe("public");
  });
  it.each(["台企銀", "台灣企銀", "合庫", "第一銀行", "華南銀行", "彰化銀行", "兆豐銀行", "土銀", "臺銀"])("辨識 %s 簡稱", name => {
    expect(bankOwnershipOf(name)).toBe("public");
  });
  it.each([
    "中國信託商業銀行股份有限公司", "台北富邦商業銀行股份有限公司", "玉山商業銀行股份有限公司",
    "國泰金融控股股份有限公司", "台新國際商業銀行", "臺灣新光商業銀行", "合作金庫金融控股股份有限公司",
    "第一金融控股股份有限公司", "兆豐國際商業銀行資訊科技股份有限公司", "國立臺灣大學",
  ])("名單以外的 %s 不因關鍵字或關聯而歸國營", name => {
    expect(bankOwnershipOf(name)).toBe("private");
  });
});
