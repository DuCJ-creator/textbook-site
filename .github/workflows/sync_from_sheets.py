#!/usr/bin/env python3
"""
sync_from_sheets.py
====================
把五份「發布為 CSV」的 Google Sheets 資料，轉換合併進各課的 data/{book}/{lesson}.json，
並自動重新產生 data/index.json（首頁的冊/課清單）。全程完全自動化——你只需要維護
Google Sheets，不需要手動編輯任何 json 檔案。

五份資料來源：
  1. Word Family        → vocabulary.rows                    （I. Word Family）
  2. Phrases             → phrases.items                      （II. Phrases & Collocations）
  3. Essential Grammar   → grammar.points                      （III.1 Key Grammar Points）
  4. Sentence Structures → grammar.sentence_structures.items   （III.2 Sentence Structures）
  5. Text Genre           → text_genre.raw_text                  （IV. Text Genre and Structure）

用法：
    python3 scripts/sync_from_sheets.py

設計原則：
  - 這支腳本是資料的「唯一真相來源」：每次執行都會用 CSV 內容完整覆蓋
    對應的區塊（例如整個 vocabulary.rows 重新產生），不是增量合併。
  - 自動上架：只要一堂課的五個來源任一有內容，就自動把 status 設為
    published，不需要手動編輯 index.json。一旦上架過，之後就算某個
    來源被清空也不會自動降回 draft（避免暫時清空重寫時網站瞬間撤掉
    已經在用的課程）。
  - data/index.json 每次同步都會完全重新產生：讀取 data/book_structure.json
    裡定義的固定冊/課骨架（例如 5 冊、每冊幾課），疊加 data/ 底下實際
    存在的課程內容與狀態。還沒有資料的冊/課會顯示為佔位項目，讓學生在
    首頁看到完整架構，而不是資料一出現才突然冒出一整冊。
  - title 一旦手動編輯過就會保留：這支腳本從不寫入 title（新建立的
    課程 title 留空），如果你之後手動編輯某課 json 補上課名，下次
    同步不會被覆蓋。
  - 空白列（老師還沒填的佔位列）會被自動跳過。

執行時機：正常情況下由 .github/workflows/sync-sheets.yml 自動定期執行，
你不需要手動跑。想立即看到更新，可以在 GitHub Actions 頁面手動觸發，
或在本機執行這支腳本後自行 commit push。
"""

import csv
import io
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path
from collections import defaultdict

# ============ 設定：五份 Google Sheets 發布連結 ============
WORD_FAMILY_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT1_u5nw24SvBbW7u87C02iDvos3Aigsz8ubmp2YHKwHZ4C4xzC5UsUKZ_2en3v7aHlj8cKFTVzTm1B/pub?gid=0&single=true&output=csv"
PHRASES_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSsMsamlfWUde7WSCOjhlZ3DIOGZDrV9XEZy3-t1LRf1EQz8ddH7nsC3onGOV5WAh--W79D2vImJ6ue/pub?gid=0&single=true&output=csv"
ESSENTIAL_GRAMMAR_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQp8n6UYP2Z-3qy-XLz1yrc8tzC0DihiYYP2HYiKfHSWSnpSOUoDerxoLI4dte_eMnGBUi1SVEWp4Kw/pub?gid=0&single=true&output=csv"
SENTENCE_STRUCTURES_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQT-TfQGM7a-jPOCxjedvm6ZF6z1nWaUl8c6Ef2UbSYtahlOD7f-u5n6UtQYN86k-MKxKpXSEa_IVco/pub?gid=0&single=true&output=csv"
TEXT_GENRE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSEs0ZHGaCajwoF9XEAbS77fy-tNn7utdJy1CJTSuUgN_uuK-XE3mi0O5V34Pg1tg0T1P4fc4x_XyEH/pub?gid=0&single=true&output=csv"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"

STRUCTURE_KEY_MAP = {
    "simple sentence": "simple",
    "compound sentence": "compound",
    "complex sentence": "complex",
    "compound-complex sentence": "compound-complex",
}


def fetch_csv_rows(url):
    """下載 CSV，回傳 (header, data_rows)，data_rows 是 list of list（依欄位順序），
    呼叫端用位置索引取值，避免重複欄名（例如 word-family 有兩個 'meaning'）互相覆蓋。
    """
    with urllib.request.urlopen(url, timeout=20) as res:
        raw = res.read().decode("utf-8-sig")
    reader = csv.reader(io.StringIO(raw))
    rows = list(reader)
    if not rows:
        return [], []
    header = rows[0]
    data_rows = [r for r in rows[1:] if any((c or "").strip() for c in r)]
    return header, data_rows


def col(row, idx, default=""):
    if idx is None or idx >= len(row):
        return default
    val = row[idx]
    return (val or "").strip() if val is not None else default


def normalize_book_lesson(book_raw, lesson_raw):
    return (book_raw or "").strip().lower(), (lesson_raw or "").strip().lower()


def load_lesson_json(book, lesson):
    path = DATA_DIR / book / f"{lesson}.json"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), path
    skeleton = {
        "book": book.upper(),
        "lesson": lesson.upper(),
        "title": "",
        "status": "draft",
        "vocabulary": {"rows": []},
        "phrases": {"items": []},
        "grammar": {"points": [], "sentence_structures": {"items": []}},
        "text_genre": {"raw_text": ""}
    }
    return skeleton, path


def save_lesson_json(data, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def has_any_content(data):
    """判斷這一課是否至少有一個來源已經有內容——用來決定是否自動上架。
    只要 vocabulary/phrases/grammar.points/grammar.sentence_structures/text_genre
    任一項不是空的，就視為「已經開始有內容」。
    """
    if data.get("vocabulary", {}).get("rows"):
        return True
    if data.get("phrases", {}).get("items"):
        return True
    if data.get("grammar", {}).get("points"):
        return True
    if data.get("grammar", {}).get("sentence_structures", {}).get("items"):
        return True
    if data.get("text_genre", {}).get("raw_text", "").strip():
        return True
    return False


def rebuild_index_json():
    """讀取固定的冊/課骨架（data/book_structure.json），疊加 data/ 底下實際存在
    的課程內容與上架狀態，重新產生 data/index.json。

    這樣即使某冊/某課還沒有任何 Google Sheets 資料，也會依骨架顯示為
    「尚未上架」的佔位項目（讓學生在首頁看到完整的 5 冊架構），
    而不是完全不存在。骨架本身（幾冊、每冊幾課）由
    data/book_structure.json 手動維護，不受同步腳本影響。
    """
    structure_path = DATA_DIR / "book_structure.json"
    with open(structure_path, "r", encoding="utf-8") as f:
        structure = json.load(f)

    books = []
    for book_def in structure["books"]:
        book_id = book_def["id"]
        lesson_count = book_def["lesson_count"]

        lessons = []
        for i in range(1, lesson_count + 1):
            lesson_id = f"l{i}"
            lesson_path = DATA_DIR / book_id / f"{lesson_id}.json"

            if lesson_path.exists():
                with open(lesson_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                # 自動上架判斷套用在每一個現存課程，不只是這次同步有更新到的課程——
                # 這樣即使某課是分次填寫（例如先填 grammar，隔幾天才補 phrases），
                # 只要之前累積下來已經有內容，重建 index.json 時就會正確反映上架狀態，
                # 不需要等到「剛好這次同步有動到這課」才被升級。
                if has_any_content(data) and data.get("status") != "published":
                    data["status"] = "published"
                    with open(lesson_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)

                entry = {
                    "id": lesson_id,
                    "title": data.get("title", ""),
                    "status": data.get("status", "draft"),
                }
                if entry["status"] == "published":
                    entry["data"] = f"data/{book_id}/{lesson_id}.json"
            else:
                # 這個位置的課還沒有任何 Sheets 資料，顯示為佔位項目
                entry = {"id": lesson_id, "title": "", "status": "draft"}

            lessons.append(entry)

        books.append({"id": book_id, "title": book_def["title"], "lessons": lessons})

    index_data = {
        "books": books,
        "cross_lesson_tools": [
            {"id": "vocab-bank", "title": "單字總覽 Vocabulary Bank", "status": "coming_soon"},
            {"id": "phrase-bank", "title": "片語總覽 Phrase Bank", "status": "coming_soon"},
            {"id": "grammar-bank", "title": "句型總覽 Grammar Bank", "status": "coming_soon"},
        ],
    }

    index_path = DATA_DIR / "index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

    total = sum(len(b["lessons"]) for b in index_data["books"])
    published = sum(1 for b in index_data["books"] for l in b["lessons"] if l["status"] == "published")
    print(f"  ✓ data/index.json 已重新產生（共 {total} 課，{published} 課已上架）")


def get_or_load(registry, book, lesson):
    key = (book, lesson)
    if key not in registry:
        data, path = load_lesson_json(book, lesson)
        registry[key] = {"data": data, "path": path}
    return registry[key]["data"]


# ============ 1. Word Family ============

def sync_word_family(registry):
    print("抓取 Word Family CSV …")
    header, rows = fetch_csv_rows(WORD_FAMILY_CSV_URL)
    print(f"  共 {len(rows)} 筆")
    IDX_BOOK, IDX_LESSON, IDX_BASE, IDX_WORD, IDX_POS, IDX_ZH, IDX_EX_EN, IDX_EX_ZH = range(8)

    grouped = defaultdict(list)
    for row in rows:
        book, lesson = normalize_book_lesson(col(row, IDX_BOOK), col(row, IDX_LESSON))
        word = col(row, IDX_WORD)
        if not book or not lesson or not word:
            continue
        grouped[(book, lesson)].append(row)

    POS_KEY_MAP = {
        "verb": "verb", "v.": "verb",
        "noun": "noun", "n.": "noun",
        "adjective": "adj", "adj.": "adj",
        "adverb": "adv", "adv.": "adv",
    }

    touched = []
    for (book, lesson), items in grouped.items():
        data = get_or_load(registry, book, lesson)

        base_order = []
        base_groups = defaultdict(lambda: {"verb": [], "noun": [], "adj": [], "adv": []})

        for row in items:
            base = col(row, IDX_BASE) or col(row, IDX_WORD)
            pos_raw = col(row, IDX_POS).lower()
            pos_key = POS_KEY_MAP.get(pos_raw)
            if pos_key is None:
                print(f"  警告：{book}/{lesson} 無法辨識詞性 {pos_raw!r}（word={col(row, IDX_WORD)!r}），已跳過此列")
                continue
            if base not in base_groups:
                base_order.append(base)
            base_groups[base][pos_key].append({
                "en": col(row, IDX_WORD),
                "zh": col(row, IDX_ZH),
                "example": col(row, IDX_EX_EN),
            })

        vocab_rows = []
        for i, base in enumerate(base_order, start=1):
            vocab_rows.append({"id": f"{book}{lesson}-v{i:02d}", "base": base, **base_groups[base]})

        data.setdefault("vocabulary", {})["rows"] = vocab_rows
        touched.append((book, lesson, len(vocab_rows)))

    for book, lesson, count in sorted(touched):
        print(f"  ✓ {book}/{lesson} ← vocabulary.rows 更新為 {count} 組字群")


# ============ 2. Phrases ============

def sync_phrases(registry):
    print("抓取 Phrases CSV …")
    header, rows = fetch_csv_rows(PHRASES_CSV_URL)
    print(f"  共 {len(rows)} 筆")
    IDX_BOOK, IDX_LESSON, IDX_WORD, IDX_POS, IDX_ZH, IDX_EX_EN, IDX_EX_ZH = range(7)

    grouped = defaultdict(list)
    for row in rows:
        book, lesson = normalize_book_lesson(col(row, IDX_BOOK), col(row, IDX_LESSON))
        phrase = col(row, IDX_WORD)
        if not book or not lesson or not phrase:
            continue
        grouped[(book, lesson)].append(row)

    touched = []
    for (book, lesson), items in grouped.items():
        data = get_or_load(registry, book, lesson)
        phrase_items = []
        for i, row in enumerate(items, start=1):
            phrase_items.append({
                "id": f"{book}{lesson}-p{i:03d}",
                "phrase": col(row, IDX_WORD),
                "pos": col(row, IDX_POS),
                "zh": col(row, IDX_ZH),
                "example_en": col(row, IDX_EX_EN),
                "example_zh": col(row, IDX_EX_ZH),
            })
        data.setdefault("phrases", {})["items"] = phrase_items
        touched.append((book, lesson, len(phrase_items)))

    for book, lesson, count in sorted(touched):
        print(f"  ✓ {book}/{lesson} ← phrases.items 更新為 {count} 筆")


# ============ 3. Essential Grammar (Key Grammar Points) ============

def sync_essential_grammar(registry):
    print("抓取 Essential Grammar CSV …")
    header, rows = fetch_csv_rows(ESSENTIAL_GRAMMAR_CSV_URL)
    print(f"  共 {len(rows)} 筆")
    IDX_BOOK, IDX_LESSON, IDX_NO, IDX_GRAMMAR, IDX_SENTENCE = range(5)

    grouped = defaultdict(list)
    for row in rows:
        book, lesson = normalize_book_lesson(col(row, IDX_BOOK), col(row, IDX_LESSON))
        grammar_title = col(row, IDX_GRAMMAR)
        if not book or not lesson or not grammar_title:
            continue
        grouped[(book, lesson)].append(row)

    touched = []
    for (book, lesson), items in grouped.items():
        data = get_or_load(registry, book, lesson)

        no_order = []
        no_groups = defaultdict(lambda: {"title": "", "examples": []})
        for row in items:
            no = col(row, IDX_NO)
            title = col(row, IDX_GRAMMAR)
            sentence = col(row, IDX_SENTENCE)
            if no not in no_groups:
                no_order.append(no)
            no_groups[no]["title"] = title
            if sentence:
                no_groups[no]["examples"].append(sentence)

        points = []
        for i, no in enumerate(no_order, start=1):
            g = no_groups[no]
            points.append({"id": f"{book}{lesson}-g{i}", "title": g["title"], "examples": g["examples"]})

        data.setdefault("grammar", {})["points"] = points
        data["grammar"].setdefault("sentence_structures", {"items": []})
        touched.append((book, lesson, len(points)))

    for book, lesson, count in sorted(touched):
        print(f"  ✓ {book}/{lesson} ← grammar.points 更新為 {count} 個文法點")


# ============ 4. Sentence Structures ============

def sync_sentence_structures(registry):
    print("抓取 Sentence Structures CSV …")
    header, rows = fetch_csv_rows(SENTENCE_STRUCTURES_CSV_URL)
    print(f"  共 {len(rows)} 筆")
    IDX_BOOK, IDX_LESSON, IDX_NO, IDX_SENTENCE, IDX_STRUCT, IDX_TYPE = range(6)

    grouped = defaultdict(list)
    for row in rows:
        book, lesson = normalize_book_lesson(col(row, IDX_BOOK), col(row, IDX_LESSON))
        sentence = col(row, IDX_SENTENCE)
        if not book or not lesson or not sentence:
            continue
        grouped[(book, lesson)].append(row)

    touched = []
    unknown_structures = set()

    for (book, lesson), items in grouped.items():
        data = get_or_load(registry, book, lesson)
        sentence_items = []
        for row in items:
            no = col(row, IDX_NO)
            structure_raw = col(row, IDX_STRUCT)
            structure_key = STRUCTURE_KEY_MAP.get(structure_raw.lower())
            if structure_key is None:
                unknown_structures.add(structure_raw)
                structure_key = "simple"

            try:
                item_id = f"{book}{lesson}-s{int(float(no)):03d}"
            except (ValueError, TypeError):
                item_id = f"{book}{lesson}-s{len(sentence_items) + 1:03d}"

            sentence_items.append({
                "id": item_id,
                "sentence": col(row, IDX_SENTENCE),
                "type": structure_key,
                "pattern": col(row, IDX_TYPE),
            })

        data.setdefault("grammar", {}).setdefault("sentence_structures", {})["items"] = sentence_items
        data["grammar"].setdefault("points", [])
        touched.append((book, lesson, len(sentence_items)))

    for book, lesson, count in sorted(touched):
        print(f"  ✓ {book}/{lesson} ← grammar.sentence_structures.items 更新為 {count} 筆")

    if unknown_structures:
        print("\n  ⚠ 警告：以下 'sentence structure' 值無法辨識，已暫時歸類為 simple，請檢查 Google Sheet 拼字：")
        for s in sorted(unknown_structures):
            print(f"      - {s!r}")
        print(f"    目前腳本認得的值：{list(STRUCTURE_KEY_MAP.keys())}")


# ============ 5. Text Genre ============

def sync_text_genre(registry):
    print("抓取 Text Genre CSV …")
    header, rows = fetch_csv_rows(TEXT_GENRE_CSV_URL)
    print(f"  共 {len(rows)} 筆")
    IDX_BOOK, IDX_LESSON, IDX_TEXT = range(3)

    touched = []
    for row in rows:
        book, lesson = normalize_book_lesson(col(row, IDX_BOOK), col(row, IDX_LESSON))
        text = col(row, IDX_TEXT)
        if not book or not lesson or not text:
            continue

        data = get_or_load(registry, book, lesson)
        data["text_genre"] = {"raw_text": text}
        touched.append((book, lesson))

    for book, lesson in sorted(touched):
        print(f"  ✓ {book}/{lesson} ← text_genre.raw_text 已更新")


def main():
    print("=" * 60)
    print("同步 Google Sheets → data/{book}/{lesson}.json")
    print("=" * 60)

    registry = {}

    try:
        sync_word_family(registry)
        print()
        sync_phrases(registry)
        print()
        sync_essential_grammar(registry)
        print()
        sync_sentence_structures(registry)
        print()
        sync_text_genre(registry)
    except urllib.error.URLError as e:
        print(f"\n✗ 網路錯誤，無法連線到 Google Sheets：{e}", file=sys.stderr)
        print("  請確認網路連線正常，且發布連結仍然有效。", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ 發生錯誤：{e}", file=sys.stderr)
        sys.exit(1)

    print()
    for (book, lesson), entry in sorted(registry.items()):
        save_lesson_json(entry["data"], entry["path"])
    print(f"已寫入 {len(registry)} 個課程檔案。")

    # 自動上架判斷統一在這裡處理：掃描所有現存課程（不限於這次同步有更新到的），
    # 套用「任一來源有內容就自動 published」的規則，並重新產生 index.json。
    print()
    rebuild_index_json()

    print("\n完成。網站會在下次部署時自動反映這些變更。")
    print("若某一課想補上課名，可直接編輯對應的 data/{book}/{lesson}.json 的 title 欄位，")
    print("下次同步時會被保留（腳本不會覆蓋既有的 title，除非該課是這次新建立的）。")


if __name__ == "__main__":
    main()
