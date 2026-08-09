/* ===========================================================
   loader.js — 共用工具
   給 lesson.html 以及未來的 *-bank.html 共用：
   - escapeHtml：安全輸出使用者/教材文字
   - speakText：文字轉語音（Web Speech API）
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

  function speakText(text) {
    if (!text || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-US";
      utter.rate = 0.9;
      window.speechSynthesis.speak(utter);
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

  return {
    escapeHtml,
    speakText,
    getUrlParam,
    fetchLessonData,
    fetchIndex,
    fetchAllPublishedLessons
  };
})();
