import React, { useEffect, useMemo, useRef, useState } from "react";
import wordsCsv from "./data/words.csv?raw"; // A:No / B:英単語 / C:日本語 / D:難易度 を想定
import studentsNumbersCsv from "./students.number.csv?raw"; // ★ 生徒番号CSV

// ========= 設定 =========
const QUESTION_COUNT = 20;
const TOTAL_TIME_SEC_DEFAULT = 300; // 全体5分
const PER_Q_TIME_SEC_DEFAULT = 20;  // 各問15〜30秒（未使用だが残置）
const USE_TOTAL_TIMER = true;       // 全体タイマーを使う
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
const APP_NAME = import.meta.env.VITE_APP_NAME;

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

// 全角/半角などの互換文字を正規化
function normalizeWidth(s) {
  return String(s || "").normalize("NFKC");
}

// 日本語比較用：幅を正規化→空白正規化→ひらがな化
function normalizeJpForCompare(s) {
  const z = normalizeWidth(s).replace(/\s+/g, " ").trim();
  return toHiragana(z);
}

// 英単語比較用：幅を正規化→空白正規化
function normalizeEnForCompare(s) {
  return normalizeWidth(s).replace(/\s+/g, " ").trim();
}

// 文字列trim（認証用）
function trim(s) {
  return String(s || "").trim();
}

function judgeAnswer({ mode, user, item }) {
  if (mode === "日本語→英単語") {
    // 全角/半角の差を NFKC で吸収して比較
    return normalizeEnForCompare(user) === normalizeEnForCompare(item.en);
  } else {
    // 英単語→日本語（回答が日本語）の場合：
    const u = normalizeJpForCompare(user);
    const answers = String(item.jpKana || item.jp)
      .split(/[／\/,、・]/) // 区切り文字で分割（／ / , 、 ・ に対応）
      .map(s => normalizeJpForCompare(s))
      .filter(Boolean); // 空要素除外

    return answers.some(ans => ans === u);
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
  // 送信UI
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sent, setSent] = useState(false);

  // ★ step に auth を追加
  const [step, setStep] = useState("auth");  // auth | start | quiz | result

  // ★ 認証関連 state
  const [authIds, setAuthIds] = useState(new Set());
  const [studentNumber, setStudentNumber] = useState("");
  const [authLoaded, setAuthLoaded] = useState(false);
  // ★ 追加：生徒番号→名前のマップ
  const [idNameMap, setIdNameMap] = useState({});

  // グローバル state
  const [name, setName] = useState("");
  const [mode, setMode] = useState(MODE_CHOICES[0]);
  const [diffChoice, setDiffChoice] = useState(DIFF_CHOICES[0]);
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [answers, setAnswers] = useState([]); // {qIndex, q, a, correct, ok}
  const [qIndex, setQIndex] = useState(0);

  // 入力欄
  const [value, setValue] = useState("");

  // タイマー
  const [totalLeft, setTotalLeft] = useState(TOTAL_TIME_SEC_DEFAULT);
  const [perLeft, setPerLeft] = useState(null); // 各問タイマー未使用
  const totalTimerRef = useRef(null);

  // レビュー表示
  const [showReview, setShowReview] = useState({ visible: false, record: null });

  // ------------------- 生徒番号CSV 読み込み -------------------
  useEffect(() => {
  try {
    const rows = parseCsvRaw(studentsNumbersCsv);

    const ids = new Set();
    const map = {};

    rows.slice(1).forEach(r => {
      const id = trim(r[1]);   // B列：生徒番号
      const nm = trim(r[2]);   // C列：名前
      if (id) {
        ids.add(id);
        if (nm) {
          map[id] = nm;        // ID→名前 の対応を保存
        }
      }
    });

    setAuthIds(ids);
    setIdNameMap(map);
  } catch (e) {
    console.error("students.number.csv の読み込み失敗:", e);
    setAuthIds(new Set());
    setIdNameMap({});
  } finally {
    setAuthLoaded(true);
  }
}, []);


  // ------------------- 単語CSV 読み込み -------------------
  useEffect(() => {
    let rows = parseCsvRaw(wordsCsv);
    if (SKIP_HEADER && rows.length) rows = rows.slice(1);

    // CSV: [No, 英単語, 日本語, 難易度]
    const mapped = rows
      .filter(r => r.length >= 4 && r[1] && r[2] && r[3])
      .map(r => ({
        no: String(r[0] ?? "").trim(),
        en: String(r[1] ?? "").trim(),
        jp: String(r[2] ?? "").trim(),
        level: String(r[3] ?? "").trim(),
        jpKana: toHiragana(String(r[2] ?? "").trim()),
      }));
    setAllItems(mapped);
  }, []);

  // 難易度フィルタ
  const filteredPool = useMemo(() => {
    const allow = normalizeDifficultyFilter(diffChoice);
    return allItems.filter(it => allow.has(it.level));
  }, [allItems, diffChoice]);

  // 開始可否
  const canStart = useMemo(
    () => filteredPool.length >= 1 && name.trim().length > 0,
    [filteredPool.length, name]
  );

  // qIndex 変更時/quiz開始時に入力欄リセット
  useEffect(() => {
    if (step === "quiz") setValue("");
  }, [qIndex, step]);

  // ★レビュー中 or quiz以外は一時停止
  const isPaused = useMemo(
    () => (step !== "quiz") || showReview.visible,
    [step, showReview.visible]
  );

  // ★タイマー管理
  useEffect(() => {
    if (!USE_TOTAL_TIMER) return;

    if (isPaused) {
      if (totalTimerRef.current) {
        clearInterval(totalTimerRef.current);
        totalTimerRef.current = null;
      }
      return;
    }

    if (!totalTimerRef.current) {
      totalTimerRef.current = setInterval(() => {
        setTotalLeft((t) => {
          if (t <= 1) {
            if (totalTimerRef.current) {
              clearInterval(totalTimerRef.current);
              totalTimerRef.current = null;
            }
            finishQuiz(); // 0秒で結果へ
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    }
  }, [isPaused]);

  // アンマウント時にタイマー停止
  useEffect(() => {
    return () => {
      if (totalTimerRef.current) clearInterval(totalTimerRef.current);
    };
  }, []);

  // ------------------- 認証処理 -------------------
  function tryAuth() {
  const id = trim(studentNumber);
  if (!id) return;

  if (authIds.has(id)) {
    // ★ 対応する名前があれば自動入力
    const autoName = idNameMap[id];
    if (autoName) {
      setName(autoName);
    }
    setStep("start");
  } else {
    alert("利用ライセンスがありません。");
  }
}


  function startQuiz() {
    const quizSet = sampleUnique(
      filteredPool,
      Math.min(QUESTION_COUNT, filteredPool.length)
    );
    setItems(quizSet);
    setAnswers([]);
    setQIndex(0);
    setStep("quiz");

    if (USE_TOTAL_TIMER) {
      setTotalLeft(TOTAL_TIME_SEC_DEFAULT);
      if (totalTimerRef.current) {
        clearInterval(totalTimerRef.current);
        totalTimerRef.current = null;
      }
    }

    setPerLeft(null);
  }

  function submitAnswer(userInput) {
    const item = items[qIndex];
    if (!item) return;

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
  }

  function finishQuiz() {
    if (totalTimerRef.current) clearInterval(totalTimerRef.current);
    setStep("result");
  }

  async function sendResult() {
    const url = import.meta.env.VITE_GAS_URL;
    if (!url) throw new Error("VITE_GAS_URL is empty");

    const payload = {
      subject: APP_NAME,
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

    const body = new URLSearchParams({ payload: JSON.stringify(payload) });

    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
      mode: "no-cors",
      keepalive: true,
    });
  }

  // ---- 画面描画 ----
  let content = null;

  // ① 認証画面
  if (step === "auth") {
    content = (
      <div style={wrapStyle}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>利用認証</h1>
        <p style={{ opacity: 0.8, marginBottom: 16 }}>生徒番号を入力してください。</p>

        {!authLoaded ? (
          <div>読み込み中…</div>
        ) : (
          <>
            <input
              style={inputStyle}
              placeholder="例：20230001"
              value={studentNumber}
              onChange={(e) => setStudentNumber(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && tryAuth()}
            />
            <button style={primaryBtnStyle} onClick={tryAuth}>
              認証する
            </button>
          </>
        )}
      </div>
    );
  }

  // ② スタート画面
  else if (step === "start") {
    content = (
      <div style={wrapStyle}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>中３英単語 OなしでOK</h1>
        <p style={{ opacity: 0.8, marginBottom: 16 }}>スタート画面</p>

        <label style={labelStyle}>あなたの名前</label>
        <input
          style={inputStyle}
          placeholder="例：ネッツ　太郎"
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

  // ③ 問題
  else if (step === "quiz") {
    const it = items[qIndex];

    if (!it) {
      content = (
        <div style={wrapStyle}>
          <div style={{ fontSize: 16, opacity: 0.8 }}>読み込み中...</div>
        </div>
      );
    } else {
      const isJpToEn = mode === "日本語→英単語";
      content = (
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
  }

  // ④ 結果
  else if (step === "result") {
    const score = answers.filter((a) => a.ok).length;

    async function handleSend() {
      setSending(true);
      setProgress(0);

      const fake = setInterval(() => {
        setProgress((p) => {
          if (p >= 100) {
            clearInterval(fake);
            setSent(true);
            setSending(false);
            return 100;
          }
          return p + 10;
        });
      }, 200);

      try {
        await sendResult();
      } catch (e) {
        console.error(e);
        alert("送信に失敗しました。VITE_GAS_URL と GAS の公開設定を確認してください。");
      }
    }

    const wrongOnly = answers.filter((a) => !a.ok);
    const handleRetryWrong = () => {
      const wrongItems = items.filter((_, i) => !answers[i].ok);
      const next = sampleUnique(
        wrongItems,
        Math.min(QUESTION_COUNT, wrongItems.length)
      );
      setItems(next);
      setAnswers([]);
      setQIndex(0);
      setStep("quiz");
    };

    content = (
      <div style={wrapStyle}>
        <h2 style={{ fontSize: 24, marginBottom: 8 }}>結果</h2>
        <div style={{ marginBottom: 8 }}>
          名前：<b>{name}</b> ／ 形式：{mode} ／ 難易度：{diffChoice}
        </div>
        <div style={{ fontSize: 20, marginBottom: 16 }}>
          得点：{score} / {answers.length}
        </div>

        <div
          style={{
            maxHeight: 300,
            overflow: "auto",
            width: "100%",
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 12,
            background: "#fafafa",
            textAlign: "left",
            color: "#111",
            marginInline: "auto",
            boxSizing: "border-box"
          }}
        >
          {answers.map((r, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8,
                padding: "6px 0",
                borderBottom: "1px solid #f0f0f0",
              }}
            >
              <div>問題：{r.q}</div>
              <div>あなた：{r.a || "（無回答）"}</div>
              <div>
                模範解答：<b>{r.correct}</b> {r.ok ? "✅" : "❌"}
              </div>
            </div>
          ))}
        </div>

        {!sent && !sending && (
          <button style={primaryBtnStyle} onClick={handleSend}>
            結果を送信
          </button>
        )}

        {sending && (
          <div style={{ marginTop: 12, width: "80%" }}>
            <div
              style={{
                height: 10,
                background: "#eee",
                borderRadius: 5,
                overflow: "hidden",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "#111",
                  transition: "width 0.2s linear",
                }}
              />
            </div>
            <div>{progress}% 送信中...</div>
          </div>
        )}

        {sent && (
          <>
            <div style={{ marginTop: 16, fontWeight: "bold" }}>✅ 送信完了！</div>
            <div
              style={{
                display: "flex",
                gap: 12,
                marginTop: 16,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button style={primaryBtnStyle} onClick={() => setStep("auth")}>
                もう一度（認証からやり直し）
              </button>
              {wrongOnly.length > 0 && (
                <button style={primaryBtnStyle} onClick={handleRetryWrong}>
                  間違えた問題を復習
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return content;
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
          {perLeft != null && <Timer label="この問題" sec={perLeft} />}
        </div>
      </div>

      <div style={questionBoxStyle}>
        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6, color: "#555" }}>問題</div>
        <div style={{ fontSize: 22, color: "#111" }}>{display}</div>
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

      <button
        style={{ ...primaryBtnStyle, opacity: showReview.visible ? 0.6 : 1 }}
        onClick={onSubmit}
        disabled={showReview.visible}
      >
        答え合わせ
      </button>

      {showReview.visible && (
        <div style={reviewStyle}>
          <div style={{ fontWeight: "bold", marginBottom: 8 }}>答え合わせ</div>
          <div>問題：{showReview.record.q}</div>
          <div>あなた：{showReview.record.a || "（無回答）"}</div>
          <div>
            模範解答：<b>{showReview.record.correct}</b>{" "}
            {showReview.record.ok ? "✅ 正解" : "❌ 不正解"}
          </div>

          {!showReview.record.ok && (
            <ReviewCorrection
              isJpToEn={isJpToEn}
              correct={showReview.record.correct}
              onSuccess={onCloseReview}
            />
          )}

          <ReviewNextButton
            enabled={true}
            onClick={onCloseReview}
          />
        </div>
      )}
    </div>
  );
}

function ReviewCorrection({ isJpToEn, correct, onSuccess }) {
  const [val, setVal] = React.useState("");
  const [ok, setOk] = React.useState(false);

  React.useEffect(() => { setVal(""); setOk(false); }, [correct]);

  function check() {
    let pass;

    if (isJpToEn) {
      pass = normalizeEnForCompare(val) === normalizeEnForCompare(correct);
    } else {
      const u = normalizeJpForCompare(val);
      const answers = String(correct)
        .split(/[／\/,、・]/)
        .map(s => normalizeJpForCompare(s))
        .filter(Boolean);

      pass = answers.some(ans => ans === u);
    }

    setOk(pass);
    if (pass) onSuccess();
  }

  return (
    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
      <input
        style={inputStyle}
        placeholder={isJpToEn ? "ここに英単語を入力" : "ここに日本語（かな可）を入力"}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") check(); }}
      />
      <button
        style={primaryBtnStyle}
        onClick={check}
      >
        正解で次へ
      </button>
      {!ok && val && (
        <div style={{ gridColumn: "1 / -1", color: "#b91c1c", fontSize: 13 }}>
          もう一度チャレンジ！（正解すると自動で次へ進みます）
        </div>
      )}
    </div>
  );
}

function ReviewNextButton({ enabled, onClick }) {
  return (
    <button
      style={{
        ...primaryBtnStyle,
        marginTop: 12,
        opacity: enabled ? 1 : 0.5,
        cursor: enabled ? "pointer" : "not-allowed",
      }}
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
    >
      次の問題へ
    </button>
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
  maxWidth: "100%",
  margin: "0 auto",
  marginInline: "auto",
  padding: "24px 16px",
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  justifyContent: "center",
  textAlign: "center",
  gap: 12,
  boxSizing: "border-box",
  alignSelf: "center",
  flex: "0 0 auto",
};

const labelStyle = { alignSelf: "center", fontSize: 14, marginTop: 8, color: "#fff" };

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  fontSize: 16,
  border: "1px solid #ddd",
  borderRadius: 12,
  background: "#fff",
  color: "#111",
};

const selectStyle = { ...inputStyle };

const primaryBtnStyle = {
  marginTop: 12,
  padding: "12px 18px",
  borderRadius: 12,
  border: "none",
  background: "#111",
  color: "#fff",
  fontSize: 16,
  cursor: "pointer",
};

const questionBoxStyle = {
  width: "100%",
  marginInline: "auto",
  background: "#f7f7f7",
  border: "1px solid #ddd",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 2px 6px rgba(0,0,0,.05)",
  color: "#111",
};

const reviewStyle = {
  width: "100%",
  marginInline: "auto",
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 16,
  padding: 14,
  marginTop: 12,
  boxShadow: "0 2px 10px rgba(0,0,0,.04)",
  color: "#111",
};
