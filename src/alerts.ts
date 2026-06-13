// 警報レジストリ (仕様 §7.1 / §7.2)。
// id は config/voices.json・音声ファイル名・API・ログで共通使用する。
// 文言(読み上げ内容)は config/voices.json 側で管理し、ここは runtime 制御
// (優先度・割り込み・連打制限) の正とする。両者の id は一致させること。

export type AlertKind = 'fixed';

export interface AlertDef {
  id: string;
  /** 発信UI / ログ表示名 */
  label: string;
  /** 再生優先度 (高いほど先) */
  priority: number;
  /** true の場合、再生中音声を中断して即再生 (仕様 §7.4。優先度92以上) */
  interrupt: boolean;
  /** 同一 id の連打制限 (ミリ秒) */
  throttleMs: number;
  kind: AlertKind;
  /** audio/ 配下のファイル名 */
  file: string;
}

// --- 制御定数 (仕様 §7.4) -------------------------------------------------
export const INTERRUPT_THRESHOLD = 92; // この優先度以上は割り込み再生
export const QUEUE_MAX = 5;            // キュー滞留の上限。超過分は破棄
export const FRESHNESS_MS = 15_000;    // 投入から15秒で鮮度切れ自動破棄
export const FREE_TTS_PRIORITY = 20;   // 自由入力TTS
export const FREE_TTS_PER_SENDER_MS = 30_000; // 同一発信者の自由TTS間隔

const fixed = (
  id: string, label: string, priority: number, throttleMs: number,
): AlertDef => ({
  id, label, priority, throttleMs,
  interrupt: priority >= INTERRUPT_THRESHOLD,
  kind: 'fixed',
  file: `${id}.ogg`,
});

// 固定音声 16種 (仕様 §7.1)
const FIXED: AlertDef[] = [
  fixed('honjin_15s',      '本陣！15秒以内',                 100, 5_000),
  fixed('honjin_40s',      '本陣！40秒以内（画面内揚陸艦）',  95, 5_000),
  fixed('machigai',        '警報間違いでした',                92, 5_000),
  fixed('toppa_a_yoriku',  'A突破・揚陸有',                   88, 10_000),
  fixed('toppa_b_yoriku',  'B突破・揚陸有',                   88, 10_000),
  fixed('toppa_a',         'A地点突破',                       85, 10_000),
  fixed('toppa_b',         'B地点突破',                       85, 10_000),
  fixed('onmitsu_honjin',  '隠密・本陣恐れ',                  80, 10_000),
  fixed('onmitsu_chuo',    '隠密・中央警戒',                  75, 10_000),
  fixed('yosaiho_chuo',    '要塞砲・中央30秒',                70, 10_000),
  fixed('yosaiho_a',       '要塞砲・A方向30秒',               70, 10_000),
  fixed('yosaiho_b',       '要塞砲・B方向30秒',               70, 10_000),
  fixed('awase_chuo',      '中央 攻撃合わせ',                 65, 15_000),
  fixed('awase_tekihonjin','敵本陣 攻撃合わせ',               65, 15_000),
  fixed('kaijo',           '警報解除',                        60, 10_000),
  fixed('test',            'テスト再生',                      10, 10_000),
];

// 定型TTS(仕様 §7.2)は運用判断により撤去。任意連絡は自由入力TTS(§7.3)でカバーする。

export const ALERTS: AlertDef[] = [...FIXED];

const BY_ID = new Map(ALERTS.map((a) => [a.id, a]));

export function getAlert(id: string): AlertDef | undefined {
  return BY_ID.get(id);
}

/** プリロードすべき全ファイル名 (固定16) */
export function allAudioFiles(): string[] {
  return ALERTS.map((a) => a.file);
}
