// 連打制限 (仕様 §7.1 / §11)。
// 警報単位(key=id)・自由TTSの発信者単位(key=`tts:<sender>`) の双方で使う。
export class Throttle {
  private last = new Map<string, number>();

  /**
   * 許可なら true を返して時刻を記録、制限中なら false。
   * @param key   制限キー (警報id, または `tts:<sender>`)
   * @param windowMs 制限窓(ミリ秒)
   */
  check(key: string, windowMs: number): boolean {
    const now = Date.now();
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < windowMs) return false;
    this.last.set(key, now);
    return true;
  }
}
