import React, { useEffect, useMemo, useRef, useState } from 'react'
import wordsCsv from './data/words.csv?raw' // ここに A:No / B:英単語 / C:日本語 / D:難易度 のCSVを置く

// ========== 設定 ==========
const QUESTION_COUNT = 20
const TOTAL_TIME_SEC_DEFAULT = 300 // 全体5分
const PER_Q_TIME_SEC_DEFAULT = 20  // 各問15〜30秒の中庸
const USE_TOTAL_TIMER = true       // 既定：全体タイマー優先
const SKIP_HEADER = false          // CSV先頭行にヘッダーがあるなら true に変更

// 難易度のUI選択肢（ご要望どおり）
const DIFF_CHOICES = [
  '入門編',
  '基本編',
  '標準編',
  '入門＋基本編',
  '入門＋基本＋標準編',
]

// 出題形式
const MODE_CHOICES = ['日本語→英単語', '英単語→日本語']

// ========== CSV パース（ヘッダー無し A/B/C/D 前提） ==========
function parseCsvRaw(csvText) {
  // 簡易CSVパーサ（引用符対応）。1行: "A","B","C","D"
  const rows = []
  let i = 0, field = '', row = [], inQuotes = false
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { rows.push(row); row = [] }

  while (i < csvText.length) {
    const c = csvText[i]
    if (inQuotes) {
      if (c === '"') {
        if (csvText[i + 1] === '"') { field += '"'; i++ } // 連続二重引用符はエスケープ
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') pushField()
      else if (c === '\n' || c === '\r') {
        // 行終端：\r\n / \n / \r いずれも許容
        // 直前がカンマで終わっている場合の空フィールドにも対応
        if (field !== '' || row.length > 0) pushField()
        if (row.length) pushRow()
        // 連続する \r\n をまとめて飛ばす
        if (c === '\r' && csvText[i + 1] === '\n') i++
      } else field += c
    }
    i++
  }
  // 最後のフィールド・行
  if (field !== '' || row.length > 0) { pushField(); pushRow() }
  return rows
}

function normalizeDifficultyFilter(choice) {
  // フィルタ対象の難易度セットを返す
  switch (choice) {
    case '入門編': return new Set(['入門編'])
    case '基本編': return new Set(['基本編'])
    case '標準編': return new Set(['標準編'])
    case '入門＋基本編': return new Set(['入門編', '基本編'])
    case '入門＋基本＋標準編': return new Set(['入門編', '基本編', '標準編'])
    default: return new Set()
  }
}

function toHiragana(str) {
  // カタカナ→ひらがな（EN→JPの“カナ同一視”用）
  return str.replace(/[\u30A1-\u30F6]/g, s =>
    String.fromCharCode(s.charCodeAt(0) - 0x60)
  )
}

function trimSpaces(s) {
  return s.replace(/\s+/g, ' ').trim()
}

function judgeAnswer({ mode, user, item }) {
  if (mode === '日本語→英単語') {
    // 完全一致（前後の空白だけ除去）
    return trimSpaces(user) === trimSpaces(item.en)
  } else {
    // 英単語→日本語：ひらがな・カタカナ同一視（ひらがな化して突き合わせ）
    const u = toHiragana(trimSpaces(user))
    const ans = toHiragana(trimSpaces(item.jpKana || item.jp))
    return u === ans
  }
}

function sampleUnique(arr, k) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, k)
}

export default function App() {
  const [name, setName] = useState('')
  const [mode, setMode] = useState(MODE_CHOICES[0])
  const [diffChoice, setDiffChoice] = useState(DIFF_CHOICES[0])
  const [allItems, setAllItems] = useState([])
  const [items, setItems] = useState([])
  const [answers, setAnswers] = useState([]) // {q, a, correct, ok}
  const [step, setStep] = useState('start') // start | quiz | result
  const [qIndex, setQIndex] = useState(0)

  // timers
  const [totalLeft, setTotalLeft] = useState(TOTAL_TIME_SEC_DEFAULT)
  const [perLeft, setPerLeft] = useState(PER_Q_TIME_SEC_DEFAULT)
  const totalTimerRef = useRef(null)
  const perTimerRef = useRef(null)

  // CSV読み込み
  useEffect(() => {
    // rows = [[A,B,C,D], ...]
    let rows = parseCsvRaw(wordsCsv)
    if (SKIP_HEADER && rows.length) rows = rows.slice(1)

    // map: {no,en,jp,level,jpKana}
    const mapped = rows
      .filter(r => r.length >= 4)
      .map(r => ({
        no: r[0],
        en: String(r[1] ?? '').trim(),
        jp: String(r[2] ?? '').trim(),
        level: String(r[3] ?? '').trim(),
        // 日本語の“読み”は未提供想定：ひらがな化のためにjpKanaを生成（ひらがなとカタカナ混在時のため）
        jpKana: toHiragana(String(r[2] ?? '').trim()),
      }))
      .filter(x => x.en && x.jp && x.level)
    setAllItems(mapped)
  }, [])

  const filteredPool = useMemo(() => {
    const allow = normalizeDifficultyFilter(diffChoice)
    return allItems.filter(it => allow.has(it.level))
  }, [allItems, diffChoice])

  const canStart = useMemo(
    () => filteredPool.length >= 1 && name.trim().length > 0,
    [filteredPool.length, name]
  )

  function startQuiz() {
    const quizSet = sampleUnique(filteredPool, Math.min(QUESTION_COUNT, filteredPool.length))
    setItems(quizSet)
    setAnswers([])
    setQIndex(0)
    setStep('quiz')

    // timers init
    if (USE_TOTAL_TIMER) {
      setTotalLeft(TOTAL_TIME_SEC_DEFAULT)
      totalTimerRef.current && clearInterval(totalTimerRef.current)
      totalTimerRef.current = setInterval(() => {
        setTotalLeft(t => {
          if (t <= 1) {
            clearInterval(totalTimerRef.current)
            finishQuiz()
            return 0
          }
          return t - 1
        })
      }, 1000)
    }
    setPerLeft(PER_Q_TIME_SEC_DEFAULT)
    perTimerRef.current && clearInterval(perTimerRef.current)
    perTimerRef.current = setInterval(() => {
      setPerLeft(t => {
        if (t <= 1) {
          // 時間切れ=未回答扱い
          submitAnswer('')
          return PER_Q_TIME_SEC_DEFAULT // 次問でリセット
        }
        return t - 1
      })
    }, 1000)
  }

  function submitAnswer(userInput) {
    const item = items[qIndex]
    const ok = judgeAnswer({ mode, user: userInput, item })
    const record = {
      qIndex,
      q: mode === '日本語→英単語' ? item.jp : item.en,
      a: userInput,
      correct: mode === '日本語→英単語' ? item.en : item.jp,
      ok,
    }
    setAnswers(prev => [...prev, record])

    // 次へ（レビュー表示 → クリックで本当に次へ）
    setShowReview({ visible: true, record })
  }

  function nextQuestion() {
    if (qIndex + 1 >= items.length) {
      finishQuiz()
      return
    }
    setQIndex(qIndex + 1)
    setPerLeft(PER_Q_TIME_SEC_DEFAULT)
  }

  function finishQuiz() {
    perTimerRef.current && clearInterval(perTimerRef.current)
    totalTimerRef.current && clearInterval(totalTimerRef.current)
    setStep('result')
    sendResult()
  }

  // レビュー表示（提出直後の「問題/自分の解答/模範解答」を見せる）
  const [showReview, setShowReview] = useState({ visible: false, record: null })

  async function sendResult() {
    try {
      const url = import.meta.env.VITE_GAS_URL
      if (!url) return
      const payload = {
        timestamp: new Date().toISOString(),
        user_name: name,
        mode,
        difficulty: diffChoice,
        score: answers.filter(a => a.ok).length,
        duration_sec: USE_TOTAL_TIMER ? (TOTAL_TIME_SEC_DEFAULT - totalLeft) : null,
        question_set_id: `auto-${Date.now()}`,
        questions: items.map(it => ({ en: it.en, jp: it.jp, level: it.level })),
        answers,
        device_info: navigator.userAgent,
      }
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      // 成功/失敗はシート側で確認。ここでは静かに完了。
    } catch (e) {
      // 送信失敗はUIに影響させない（学習体験優先）
      console.warn('Send failed', e)
    }
  }

  // ---- UI ----
  if (step === 'start') {
    return (
      <div style={wrapStyle}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>eitango-chu3</h1>
        <p style={{ opacity: .8, marginBottom: 16 }}>スタート画面</p>

        <label style={labelStyle}>あなたの名前</label>
        <input
          style={inputStyle}
          placeholder="例：hira-chan"
          value={name}
          onChange={e => setName(e.target.value)}
        />

        <label style={labelStyle}>出題形式</label>
        <select style={selectStyle} value={mode} onChange={e => setMode(e.target.value)}>
          {MODE_CHOICES.map(x => <option key={x} value={x}>{x}</option>)}
        </select>

        <label style={labelStyle}>難易度</label>
        <select style={selectStyle} value={diffChoice} onChange={e => setDiffChoice(e.target.value)}>
          {DIFF_CHOICES.map(x => <option key={x} value={x}>{x}</option>)}
        </select>

        <div style={{fontSize:12, marginTop:8, opacity:.8}}>
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
    )
  }

  if (step === 'quiz') {
    const it = items[qIndex]
    const isJpToEn = mode === '日本語→英単語'
    const [value, setValue] = useState('')
    // 1問ごとに入力状態をリセットするため、keyにqIndexを与える
    return (
      <QuizFrame
        key={qIndex}
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
        onCloseReview={() => { setShowReview({visible:false, record:null}); nextQuestion() }}
      />
    )
  }

  if (step === 'result') {
    const score = answers.filter(a => a.ok).length
    return (
      <div style={wrapStyle}>
        <h2 style={{ fontSize: 24, marginBottom: 8 }}>結果</h2>
        <div style={{ marginBottom: 8 }}>
          名前：<b>{name}</b> ／ 形式：{mode} ／ 難易度：{diffChoice}
        </div>
        <div style={{ fontSize: 20, marginBottom: 16 }}>得点：{score} / {answers.length}</div>
        <div style={{maxHeight: 300, overflow:'auto', width:'100%', border:'1px solid #eee', borderRadius:12, padding:12}}>
          {answers.map((r, i) => (
            <div key={i} style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, padding:'6px 0', borderBottom:'1px solid #f0f0f0'}}>
              <div>問題：{r.q}</div>
              <div>あなた：{r.a || '（無回答）'}</div>
              <div>模範解答：<b>{r.correct}</b> {r.ok ? '✅' : '❌'}</div>
            </div>
          ))}
        </div>
        <button style={primaryBtnStyle} onClick={() => { setStep('start'); setName(name); }}>
          もう一度
        </button>
      </div>
    )
  }

  return null
}

// ---- 小さめのUI部品 ----
function QuizFrame({ index, total, isJpToEn, display, totalLeft, perLeft, value, setValue, onSubmit, showReview, onCloseReview }) {
  return (
    <div style={wrapStyle}>
      <div style={{display:'flex', justifyContent:'space-between', width:'100%', marginBottom:8}}>
        <div>Q {index + 1} / {total}</div>
        <div style={{display:'flex', gap:12}}>
          {totalLeft != null && <Timer label="全体" sec={totalLeft} />}
          <Timer label="この問題" sec={perLeft} />
        </div>
      </div>

      <div style={questionBoxStyle}>
        <div style={{opacity:.7, fontSize:12, marginBottom:6}}>問題</div>
        <div style={{fontSize:22}}>{display}</div>
      </div>

      <label style={labelStyle}>{isJpToEn ? '英単語を入力' : '日本語で入力（かなOK）'}</label>
      <input
        style={inputStyle}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit() }}
        placeholder={isJpToEn ? 'example: run' : '例：はしる（カタカナでもOK）'}
      />
      <button style={primaryBtnStyle} onClick={onSubmit}>答え合わせ</button>

      {showReview.visible && (
        <div style={reviewStyle}>
          <div style={{fontWeight:'bold', marginBottom:8}}>答え合わせ</div>
          <div>問題：{showReview.record.q}</div>
          <div>あなた：{showReview.record.a || '（無回答）'}</div>
          <div>模範解答：<b>{showReview.record.correct}</b> {showReview.record.ok ? '✅ 正解' : '❌ 不正解'}</div>
          <button style={{...primaryBtnStyle, marginTop:12}} onClick={onCloseReview}>次の問題へ</button>
        </div>
      )}
    </div>
  )
}

function Timer({ label, sec }) {
  const mm = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return <div style={{fontFamily:'ui-monospace, monospace'}}>{label}:{mm}:{ss}</div>
}

// ---- styles（簡潔に：モバイル親指サイズを意識）----
const wrapStyle = { width:'min(680px, 92vw)', margin:'24px auto', display:'flex', flexDirection:'column', alignItems:'center', gap:12 }
const labelStyle = { alignSelf:'flex-start', fontSize:14, marginTop:8 }
const inputStyle = { width:'100%', padding:'12px 14px', fontSize:16, border:'1px solid #ddd', borderRadius:12 }
const selectStyle = { ...inputStyle }
const primaryBtnStyle = { marginTop:12, padding:'12px 18px', borderRadius:12, border:'none', background:'#111', color:'#fff', fontSize:16, cursor:'pointer' }
const questionBoxStyle = { width:'100%', background:'#fafafa', border:'1px solid #eee', borderRadius:16, padding:'14px' }
const reviewStyle = { width:'100%', background:'#fff', border:'1px solid #eee', borderRadius:16, padding:'14px', marginTop:12, boxShadow:'0 2px 10px rgba(0,0,0,.04)' }
