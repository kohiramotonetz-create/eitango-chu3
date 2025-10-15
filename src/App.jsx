import React, { useEffect, useMemo, useRef, useState } from "react";
import wordsCsv from "./data/words.csv?raw"; // A:No / B:英単語 / C:日本語 / D:難易度 を想定

// ========= 設定 =========
const QUESTION_COUNT = 20;
const TOTAL_TIME_SEC_DEFAULT = 300; // 全体5分
const PER_Q_TIME_SEC_DEFAULT = 20;  // 各問15〜30秒の中庸
const USE_TOTAL_TIMER = true;       // 既定：全体タイマー優先
const SKIP_HEADER = false;          // CSV先頭行にヘッダーがある場合のみ true

// 難易度のUI選択肢
const DIFF_CHOICES = [
  "入門編",
  "基本編",
  "標準編",
  "入門＋基本編",
  "入門＋基本＋標準編",
];

// 出題形式
const MODE_CHOICES = ["日本語→英単語", "英単語→日本語"];

// ========= ユーティリティ =========
function parseCsvRaw(csvText) {
  // 簡易CSVパーサ（引用符対応）
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };

  while (i < csvText.length) {
    const c = csvText[i];
    if (inQuotes) {
      if (c === '"') {
        if (csvText[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") pushField();
      else if (c === "\n" || c === "\r") {
        if (field !== "" || row.length > 0) pushField();
        if (row.length) pushRow();
        if (c === "\r" && csvText[i + 1] === "\n") i++;
      } else field += c;
    }
    i++;
  }
  if (field !== "" || row.length > 0) { pushField(); pushRow(); }
  return rows;
}

function normalizeDifficultyFilter(choice) {
  switch (choice) {
    case "入門編": return new Set(["入門編"]);
    case "基本編": return new Set(["基本編"]);
    case "標準編": return new Set(["標準編"]);
    case "入門＋基本編": return new Set(["入門編", "基本編"]);
    case "入門＋基本＋標準編": return new Set(["入門編", "基本編", "標準編"]);
    default: return new Set();
  }
}

function toHiragana(str) {
  // カタカナ→ひらがな（EN→JPの“カナ同一視”用）
  return String(str || "").replace(/[\u30A1-\u30F6]/g, s =>
    String.fromCharCode(s.charCodeAt(0) - 0x60)
  );
}

function trimSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function judgeAnswer({ mode, user, item }) {
  if (mode === "日本語→英単語") {
    // 完全一致（前後空白のみ無視）
    return trimSpaces(user) === trimSpaces(item.en);
  } else {
    // 英単語→日本語：ひらがな・カタカナ同一視
    const u = toHiragana(trimSpaces(user));
    const ans = toHiragana(trimSpaces(item.jpKana || item.jp));
    return u === ans;
  }
}

function sampleUnique(arr, k) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

// ========= メインコンポーネント =========
export default function App() {
  // グローバルな state（※Hookは常にコンポーネント直下で宣言：条件分岐内に置かない）
  const [name, setName] = useState("");
  const [mode, setMode] = useState(MODE_CHOICES[0]);
  const [diffChoice, setDiffChoice] = useState(DIFF_CHOICES[0]);
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [answers, setAnswers] = useState([]); // {qIndex, q, a, correct, ok}
  const [step, setStep] = useState("start");  // start | quiz | result
  const [qIndex, setQIndex] = useState(0);

  // 入力欄の値（※条件分岐内でuseStateを宣言しない）
  const [value, setValue] = useState("");

  // timers
  const [totalLeft, setTotalLeft] = useState(TOTAL_TIME_SEC_DEFAULT);
  const [perLeft, setPerLeft] = useState(PER_Q_TIME_SEC_DEFAULT);
  const totalTimerRef = useRef(null);
  const perTimerRef = useRef(null);

  // CSV読み込み
  useEffect(() => {
    let rows = parseCsvRaw(wordsCsv);
    if (SKIP_HEADER && rows.length) rows = rows.slice(1);

    // CSV: [No, 英単語, 日本語, 難易度]
    const mapped = rows
      .filter(r => r.length >= 4 && r[1] && r[2] && r[3]) // 空行/不完全行スキップ
      .map(r => ({
        no: String(r[0] ?? "").trim(),
        en: String(r[1] ?? "").trim(),
        jp: String(r[2] ?? "").trim(),
        level: String(r[3] ?? "").trim(),
        jpKana: toHiragana(String(r[2] ?? "").trim()),
      }));
    setAllItems(mapped);
  }, []);

  // 難易度フィルタ適用
  const filteredPool = useMemo(() => {
    const allow = normalizeDifficultyFilter(diffChoice);
    return allItems.filter(it => allow.has(it.level));
  }, [allItems, diffChoice]);

  // 開始可能条件
  const canStart = useMemo(
    () => filteredPool.length >= 1 && name.trim().length > 0,
    [filteredPool.length, name]
  );

  // qIndex 変更時/quiz開始時に入力欄をリセット
  useEffect(() => {
    if (step === "quiz") setValue("");
  }, [qIndex, step]);

  // コンポーネントのアンマウント時にタイマー停止
  useEffect(() => {
    return () => {
      if (totalTimerRef.current) clearInterval(totalTimerRef.current);
      if (perTimerRef.current) clearInterval(perTimerRef.current);
    };
  }, []);

  function startQuiz() {
    const quizSet = sampleUnique(
      filteredPool,
      Math.min(QUESTION_COUNT, filteredPool.length)
    );
    setItems(quizSet);
    setAnswers([]);
    setQIndex(0);
    setStep("quiz");

    // timers init
    if (USE_TOTAL_TIMER) {
      setTotalLeft(TOTAL_TIME_SEC_DEFAULT);
      if (totalTimerRef.current) clearInterval(totalTimerRef.current);
      totalTimerRef.current = setInterval(() => {
        setTotalLeft((t) => {
          if (t <= 1) {
            clearInterval(totalTimerRef.current);
            finishQuiz();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    }
    setPerLeft(PER_Q_TIME_SEC_DEFAULT);
    if (perTimerRef.current) clearInterval(perTimerRef.current);
    perTimerRef.current = setInterval(() => {
      setPerLeft((t) => {
        if (t <= 1) {
          // 時間切れ=未回答
          submitAnswer("");
          return PER_Q_TIME_SEC_DEFAULT; // 次問でリセット
        }
        return t - 1;
      });
    }, 1000);
  }

  function submitAnswer(userInput) {
    const item = items[qIndex];
    const ok = judgeAnswer({ mode, user: userInput, item });
    const record = {
      qIndex,
      q: mode === "日本語→英単語" ? item.jp : item.en,
      a: userInput,
      correct: mode === "日本語→英単語" ? item.en : item.jp,
      ok,
    };
    setAnswers((prev) => [...prev, record]);
    setShowReview({ visible: true, record });
  }

  function nextQuestion() {
    if (qIndex + 1 >= items.length) {
      finishQuiz();
      return;
    }
    setQIndex(qIndex + 1);
    setPerLeft(PER_Q_TIME_SEC_DEFAULT);
  }

  function finishQuiz() {
    if (perTimerRef.current) clearInterval(perTimerRef.current);
    if (totalTimerRef.current) clearInterval(totalTimerRef.current);
    setStep("result");
    sendResult();
  }

  // レビュー表示（提出直後に「問題/自分の解答/模範解答」を出す）
  const [showReview, setShowReview] = useState({ visible: false, record: null });

  async function sendResult() {
    try {
      const url = import.meta.env.VITE_GAS_URL;
      if (!url) return;
      const payload = {
        timestamp: new Date().toISOString(),
        user_name: name,
        mode,
        difficulty: diffChoice,
        score: answers.filter((a) => a.ok).length,
        duration_sec: USE_TOTAL_TIMER ? (TOTAL_TIME_SEC_DEFAULT - totalLeft) : null,
        question_set_id: `auto-${Date.now()}`,
        questions: items.map((it) => ({ en: it.en, jp: it.jp, level: it.level })),
        answers,
        device_info: navigator.userAgent,
      };
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn("Send failed", e);
    }
  }

  // ---- 画面描画 ----
  if (step === "start") {
    return (
      <div style={wrapStyle}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>eitango-chu3</h1>
        <p style={{ opacity: 0.8, marginBottom: 16 }}>スタート画面</p>

        <label style={labelStyle}>あなたの名前</label>
        <input
          style={inputStyle}
          placeholder="例：hira-chan"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label style={labelStyle}>出題形式</label>
        <select
          style={selectStyle}
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          {MODE_CHOICES.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>

        <label style={labelStyle}>難易度</label>
        <select
          style={selectStyle}
          value={diffChoice}
          onChange={(e) => setDiffChoice(e.target.value)}
        >
          {DIFF_CHOICES.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>

        <div style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>
          利用可能な単語数：{filteredPool.length} / {allItems.length}
        </div>

        <button
          style={primaryBtnStyle}
          onClick={startQuiz}
          disabled={!canStart}
        >
          開始（{QUESTION_COUNT}問）
        </button>
      </div>
    );
  }

  if (step === "quiz") {
    const it = items[qIndex];
    const isJpToEn = mode === "日本語→英単語";
    return (
      <QuizFrame
        index={qIndex}
        total={items.length}
        isJpToEn={isJpToEn}
        display={isJpToEn ? it.jp : it.en}
        totalLeft={USE_TOTAL_TIMER ? totalLeft : null}
        perLeft={perLeft}
        value={value}
        setValue={setValue}
        onSubmit={() => submitAnswer(value)}
        showReview={showReview}
        onCloseReview={() => { setShowReview({ visible: false, record: null }); nextQuestion(); }}
      />
    );
  }

if (step === "result") {
-   const score = answers.filter((a) => a.ok).length;
-   return (
-     <div style={wrapStyle}>
-       ...（今の結果表示UI）
-     </div>
-   );
+   // 🟨【ここから新しいコードに差し替え】🟨
+   const score = answers.filter((a) => a.ok).length;
+   const [sending, setSending] = useState(false);
+   const [progress, setProgress] = useState(0);
+   const [sent, setSent] = useState(false);
+
+   async function handleSend() {
+     setSending(true);
+     setProgress(0);
+     const fake = setInterval(() => {
+       setProgress((p) => {
+         if (p >= 100) {
+           clearInterval(fake);
+           setSent(true);
+           setSending(false);
+           return 100;
+         }
+         return p + 10;
+       });
+     }, 200);
+     await sendResult();
+   }
+
+   const wrongOnly = answers.filter((a) => !a.ok);
+   const handleRetryWrong = () => {
+     const wrongItems = items.filter((_, i) => !answers[i].ok);
+     setItems(sampleUnique(wrongItems, Math.min(QUESTION_COUNT, wrongItems.length)));
+     setAnswers([]);
+     setQIndex(0);
+     setStep("quiz");
+   };
+
+   return (
+     <div style={wrapStyle}>
+       <h2 style={{ fontSize: 24, marginBottom: 8 }}>結果</h2>
+       <div style={{ marginBottom: 8 }}>
+         名前：<b>{name}</b> ／ 形式：{mode} ／ 難易度：{diffChoice}
+       </div>
+       <div style={{ fontSize: 20, marginBottom: 16 }}>
+         得点：{score} / {answers.length}
+       </div>
+
+       {/* 🟦結果一覧ボックス（中央寄せ＋背景統一）🟦 */}
+       <div
+         style={{
+           maxHeight: 300,
+           overflow: "auto",
+           width: "100%",
+           border: "1px solid #ddd",
+           borderRadius: 12,
+           padding: 12,
+           background: "#fafafa",
+           textAlign: "left",
+         }}
+       >
+         {answers.map((r, i) => (
+           <div
+             key={i}
+             style={{
+               display: "grid",
+               gridTemplateColumns: "1fr 1fr 1fr",
+               gap: 8,
+               padding: "6px 0",
+               borderBottom: "1px solid #f0f0f0",
+             }}
+           >
+             <div>問題：{r.q}</div>
+             <div>あなた：{r.a || "（無回答）"}</div>
+             <div>
+               模範解答：<b>{r.correct}</b> {r.ok ? "✅" : "❌"}
+             </div>
+           </div>
+         ))}
+       </div>
+
+       {/* 🟩送信ボタン・進捗バー・完了表示🟩 */}
+       {!sent && !sending && (
+         <button style={primaryBtnStyle} onClick={handleSend}>
+           結果を送信
+         </button>
+       )}
+
+       {sending && (
+         <div style={{ marginTop: 12, width: "80%" }}>
+           <div style={{
+             height: 10,
+             background: "#eee",
+             borderRadius: 5,
+             overflow: "hidden",
+             marginBottom: 6,
+           }}>
+             <div style={{
+               width: `${progress}%`,
+               height: "100%",
+               background: "#111",
+               transition: "width 0.2s linear",
+             }}/>
+           </div>
+           <div>{progress}% 送信中...</div>
+         </div>
+       )}
+
+       {sent && (
+         <>
+           <div style={{ marginTop: 16, fontWeight: "bold" }}>✅ 送信完了！</div>
+           <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
+             <button style={primaryBtnStyle} onClick={() => setStep("start")}>
+               ホームへ戻る
+             </button>
+             {wrongOnly.length > 0 && (
+               <button style={primaryBtnStyle} onClick={handleRetryWrong}>
+                 間違えた問題を復習
+               </button>
+             )}
+           </div>
+         </>
+       )}
+     </div>
+   );
+   // 🟨【ここまで差し替え】🟨
}

// ========= 小さめのUI部品 =========
function QuizFrame({
  index,
  total,
  isJpToEn,
  display,
  totalLeft,
  perLeft,
  value,
  setValue,
  onSubmit,
  showReview,
  onCloseReview,
}) {
  return (
    <div style={wrapStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: "100%",
          marginBottom: 8,
        }}
      >
        <div>Q {index + 1} / {total}</div>
        <div style={{ display: "flex", gap: 12 }}>
          {totalLeft != null && <Timer label="全体" sec={totalLeft} />}
          <Timer label="この問題" sec={perLeft} />
        </div>
      </div>

      <div style={questionBoxStyle}>
        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6 }}>問題</div>
        <div style={{ fontSize: 22 }}>{display}</div>
      </div>

      <label style={labelStyle}>
        {isJpToEn ? "英単語を入力" : "日本語で入力（かなOK）"}
      </label>
      <input
        style={inputStyle}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
        placeholder={isJpToEn ? "example: run" : "例：はしる（カタカナでもOK）"}
      />
      <button style={primaryBtnStyle} onClick={onSubmit}>答え合わせ</button>

      {showReview.visible && (
        <div style={reviewStyle}>
          <div style={{ fontWeight: "bold", marginBottom: 8 }}>答え合わせ</div>
          <div>問題：{showReview.record.q}</div>
          <div>あなた：{showReview.record.a || "（無回答）"}</div>
          <div>
            模範解答：<b>{showReview.record.correct}</b>{" "}
            {showReview.record.ok ? "✅ 正解" : "❌ 不正解"}
          </div>
          <button style={{ ...primaryBtnStyle, marginTop: 12 }} onClick={onCloseReview}>
            次の問題へ
          </button>
        </div>
      )}
    </div>
  );
}

function Timer({ label, sec }) {
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return <div style={{ fontFamily: "ui-monospace, monospace" }}>{label}:{mm}:{ss}</div>;
}

// ========= スタイル =========
const wrapStyle = {
  width: "min(680px, 92vw)",
  margin: "24px auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center", // ← 追加
  textAlign: "center",      // ← 追加
  gap: 12,
};
const labelStyle = { alignSelf: "flex-start", fontSize: 14, marginTop: 8 };
const inputStyle = { width: "100%", padding: "12px 14px", fontSize: 16, border: "1px solid #ddd", borderRadius: 12 };
const selectStyle = { ...inputStyle };
const primaryBtnStyle = { marginTop: 12, padding: "12px 18px", borderRadius: 12, border: "none", background: "#111", color: "#fff", fontSize: 16, cursor: "pointer" };
const questionBoxStyle = {
  width: "100%",
  background: "#f7f7f7", // ← 柔らかいグレー
  border: "1px solid #ddd", // ← 他要素と統一
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 2px 6px rgba(0,0,0,.05)", // ← 少しだけ影を足して立体感
};

const reviewStyle = { width: "100%", background: "#fff", border: "1px solid #eee", borderRadius: 16, padding: 14, marginTop: 12, boxShadow: "0 2px 10px rgba(0,0,0,.04)" };
