/* ===========================================================
   loader.js — 共用工具
   給 lesson.html 以及未來的 *-bank.html 共用：
   - escapeHtml：安全輸出使用者/教材文字
   - speakText：文字轉語音（Web Speech API），單段
   - speakSequence：依序播放多段文字（例如先讀片語、再讀例句）
   - getUrlParam：讀取網址參數
   - fetchLessonData：抓取單一課程 json
   - fetchAllPublishedLessons：抓取 index.json 裡所有已發布課程的完整資料
     （這是 vocab-bank.html / phrase-bank.html / grammar-bank.html 之後會用到的入口）
=========================================================== */

const Loader = (function () {

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function makeUtterance(text) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = 0.9;
    return utter;
  }

  function speakText(text) {
    if (!text || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(makeUtterance(text));
    } catch (e) { /* speech synthesis unavailable */ }
  }

  /**
   * 依序播放多段文字，前一段唸完才唸下一段（用 utterance 的 onend 事件串接）。
   * 用於「先讀片語、再讀例句」這種一鍵連播情境。
   * 會先 cancel 掉任何進行中的語音，確保連續點擊按鈕時不會疊加播放。
   * 空字串或 undefined 的段落會被跳過，不會插入靜音停頓。
   * @param {string[]} texts 依播放順序排列的文字陣列
   */
  function speakSequence(texts) {
    if (!("speechSynthesis" in window)) return;
    const queue = (texts || []).filter(t => t && String(t).trim());
    if (!queue.length) return;

    try {
      window.speechSynthesis.cancel();
      let i = 0;
      const playNext = () => {
        if (i >= queue.length) return;
        const utter = makeUtterance(queue[i]);
        i += 1;
        if (i < queue.length) utter.onend = playNext;
        window.speechSynthesis.speak(utter);
      };
      playNext();
    } catch (e) { /* speech synthesis unavailable */ }
  }

  function getUrlParam(name, fallback) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || fallback;
  }

  /**
   * 抓取單一課程的資料檔。
   * @param {string} bookId  例如 "b1"
   * @param {string} lessonId 例如 "l1"
   * @returns {Promise<object>} 該課程的完整 JSON 資料
   */
  function fetchLessonData(bookId, lessonId) {
    return fetch(`data/${bookId}/${lessonId}.json`).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}（${bookId}/${lessonId}.json）`);
      return res.json();
    });
  }

  /**
   * 抓取課程總索引（data/index.json）。
   * @returns {Promise<object>}
   */
  function fetchIndex() {
    return fetch("data/index.json").then(res => {
      if (!res.ok) throw new Error("HTTP " + res.status + "（data/index.json）");
      return res.json();
    });
  }

  /**
   * 抓取所有「已發布」課程的完整資料，用於跨課總覽頁面
   * （vocab-bank.html / phrase-bank.html / grammar-bank.html）。
   * 逐一 fetch 每個已發布課程的 json，並在結果中附上 book/lesson 來源方便標示。
   * 單一課程載入失敗不會擋住其他課程，只會在 console 留下警告。
   * @returns {Promise<Array<object>>} 每個元素是該課程 json，並附加 _book/_lesson 欄位
   */
  async function fetchAllPublishedLessons() {
    const index = await fetchIndex();
    const targets = [];
    index.books.forEach(book => {
      book.lessons.forEach(lesson => {
        if (lesson.status === "published") {
          targets.push({ bookId: book.id, lessonId: lesson.id });
        }
      });
    });

    const results = await Promise.all(
      targets.map(async t => {
        try {
          const data = await fetchLessonData(t.bookId, t.lessonId);
          data._book = t.bookId;
          data._lesson = t.lessonId;
          return data;
        } catch (err) {
          console.warn(`跳過 ${t.bookId}/${t.lessonId}：`, err.message);
          return null;
        }
      })
    );

    return results.filter(Boolean);
  }

  /**
   * 通用的「星標收藏」localStorage 存取工具。不同種類的內容（單字、片語）
   * 各自用不同的 key，避免混在一起；同一種內容的 key 在所有頁面共用，
   * 這樣在字典索引頁標星、去對應的 bank 頁面或單課頁面也會看到已標星狀態。
   */
  function loadStarredSet(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) {
      return new Set();
    }
  }

  function saveStarredSet(storageKey, set) {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...set]));
    } catch (e) {
      // localStorage 可能因隱私模式或空間不足而寫入失敗，安靜忽略即可
    }
  }

  return {
    escapeHtml,
    speakText,
    speakSequence,
    getUrlParam,
    fetchLessonData,
    fetchIndex,
    fetchAllPublishedLessons,
    loadStarredSet,
    saveStarredSet
  };
})();
