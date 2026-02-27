#!/usr/bin/env node
/**
 * .craftlog マージツール
 * 複数のJSONLファイルをelapsed_msを連続させながらマージする
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

const CRAFTLOG_DIR = '.craftlog';
const OUTPUT_FILE = path.join(CRAFTLOG_DIR, 'merged.jsonl');

/**
 * JSONLファイルを読み込んでパースする
 */
async function readJsonlFile(filePath) {
  const entries = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        entries.push(JSON.parse(line));
      } catch (e) {
        console.warn(`Warning: Failed to parse line in ${filePath}: ${line.substring(0, 50)}...`);
      }
    }
  }
  return entries;
}

/**
 * .craftlogディレクトリから全てのJSONLファイルを取得
 * merged.jsonlを最初に、その後に新しいセッションファイルを読み込む
 */
function getAllJsonlFiles() {
  const files = fs.readdirSync(CRAFTLOG_DIR);
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

  // merged.jsonlを最初に、他のファイルをソート順で
  const mergedFile = jsonlFiles.find(f => f === 'merged.jsonl');
  const sessionFiles = jsonlFiles.filter(f => f !== 'merged.jsonl').sort();

  const result = [];
  if (mergedFile) {
    result.push({ path: path.join(CRAFTLOG_DIR, mergedFile), isMerged: true });
  }
  sessionFiles.forEach(f => {
    result.push({ path: path.join(CRAFTLOG_DIR, f), isMerged: false });
  });

  return result;
}

/**
 * .craftlogディレクトリから新しいセッションファイルのみを取得
 * (merged.jsonl以外の.jsonlファイル)
 */
function getSessionFiles() {
  const files = fs.readdirSync(CRAFTLOG_DIR);
  return files
    .filter(f => f.endsWith('.jsonl') && f !== 'merged.jsonl')
    .map(f => path.join(CRAFTLOG_DIR, f))
    .sort(); // ファイル名でソート（日付順）
}

/**
 * エントリをタイムスタンプでソートする
 */
function sortByTimestamp(entries) {
  return entries.sort((a, b) => a.ts - b.ts);
}

/**
 * 重複エントリを除去する（tsをキーとして使用）
 */
function deduplicateEntries(entries) {
  const seen = new Map();
  for (const entry of entries) {
    const key = `${entry.ts}_${entry.session_id}_${entry.event}`;
    // 既に存在する場合は、original_elapsed_msを持つ方を優先（新しいセッションファイルから）
    if (!seen.has(key) || !entry.merged_at) {
      seen.set(key, entry);
    }
  }
  return Array.from(seen.values());
}

/**
 * セッション内の元のelapsed_msを取得
 * original_elapsed_msがあればそれを使用、なければtsから計算
 */
function getOriginalElapsedMs(entry, sessionStartTs) {
  if (entry.original_elapsed_ms !== undefined) {
    return entry.original_elapsed_ms;
  }
  // merged.jsonlから読み込んだデータで、セッション開始からのtsの差分で計算
  return entry.ts - sessionStartTs;
}

/**
 * elapsed_msを連続的に再計算する
 * 各セッションの開始時点を起点として、全体で連続したelapsed_msを付与
 */
function recalculateElapsedMs(entries) {
  if (entries.length === 0) return entries;

  // セッションごとにグループ化
  const sessionMap = new Map();
  for (const entry of entries) {
    const sessionId = entry.session_id;
    if (!sessionMap.has(sessionId)) {
      sessionMap.set(sessionId, []);
    }
    sessionMap.get(sessionId).push(entry);
  }

  // 各セッション内でtsでソート（元のelapsed_msは既にマージされている可能性があるため）
  for (const [sessionId, sessionEntries] of sessionMap) {
    sessionEntries.sort((a, b) => a.ts - b.ts);
  }

  // セッションを開始タイムスタンプでソート
  const sessions = Array.from(sessionMap.entries())
    .map(([sessionId, sessionEntries]) => ({
      sessionId,
      entries: sessionEntries,
      startTs: sessionEntries[0]?.ts || 0
    }))
    .sort((a, b) => a.startTs - b.startTs);

  // マージされたエントリを作成（elapsed_msを連続させる）
  const result = [];
  let cumulativeElapsedMs = 0;

  for (const session of sessions) {
    const sessionStartElapsed = cumulativeElapsedMs;
    let maxElapsedInSession = 0;

    const sessionStartTs = session.entries[0]?.ts || 0;

    for (const entry of session.entries) {
      const newEntry = { ...entry };
      // セッション内の元のelapsed_msを取得
      const origElapsed = getOriginalElapsedMs(entry, sessionStartTs);
      // 累積値を加算
      newEntry.elapsed_ms = sessionStartElapsed + origElapsed;
      newEntry.original_elapsed_ms = origElapsed; // 元の値を保持
      newEntry.merged_at = new Date().toISOString();
      result.push(newEntry);

      maxElapsedInSession = Math.max(maxElapsedInSession, entry.elapsed_ms);
    }

    // 次のセッション用に累積時間を更新
    cumulativeElapsedMs = sessionStartElapsed + maxElapsedInSession;
  }

  return result;
}

/**
 * エントリをJSONLファイルに書き出す
 */
function writeJsonlFile(filePath, entries) {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * マージの統計情報を表示
 */
function printStats(sessions, mergedEntries) {
  console.log('\n=== Merge Statistics ===');
  console.log(`Total sessions: ${sessions.length}`);
  console.log(`Total entries: ${mergedEntries.length}`);

  if (mergedEntries.length > 0) {
    const lastEntry = mergedEntries[mergedEntries.length - 1];
    const totalDurationMs = lastEntry.elapsed_ms;
    const totalDurationSec = (totalDurationMs / 1000).toFixed(1);
    const totalDurationMin = (totalDurationMs / 60000).toFixed(2);
    console.log(`Total duration: ${totalDurationMs}ms (${totalDurationSec}s / ${totalDurationMin}min)`);
  }

  // セッションごとの情報
  const sessionMap = new Map();
  for (const entry of mergedEntries) {
    if (!sessionMap.has(entry.session_id)) {
      sessionMap.set(entry.session_id, { count: 0, minElapsed: Infinity, maxElapsed: 0 });
    }
    const stats = sessionMap.get(entry.session_id);
    stats.count++;
    stats.minElapsed = Math.min(stats.minElapsed, entry.elapsed_ms);
    stats.maxElapsed = Math.max(stats.maxElapsed, entry.elapsed_ms);
  }

  console.log('\nSessions:');
  for (const [sessionId, stats] of sessionMap) {
    console.log(`  ${sessionId}: ${stats.count} entries, elapsed_ms range: ${stats.minElapsed} - ${stats.maxElapsed}`);
  }
}

async function main() {
  // コマンドライン引数の処理
  const args = process.argv.slice(2);
  const outputFile = args.includes('-o')
    ? args[args.indexOf('-o') + 1]
    : OUTPUT_FILE;
  const keepOriginalElapsed = args.includes('--keep-original');
  const dryRun = args.includes('--dry-run');

  console.log('Craftlog Merge Tool');
  console.log('===================\n');

  // 全てのJSONLファイルを取得（merged.jsonl + セッションファイル）
  const allFiles = getAllJsonlFiles();

  if (allFiles.length === 0) {
    console.log('No JSONL files found.');
    return;
  }

  console.log(`Found ${allFiles.length} file(s):`);
  allFiles.forEach(f => console.log(`  - ${f.path} ${f.isMerged ? '(existing merged)' : '(session)'}`));

  // 全ファイルを読み込み
  console.log('\nReading files...');
  const allEntries = [];
  for (const file of allFiles) {
    const entries = await readJsonlFile(file.path);
    console.log(`  ${file.path}: ${entries.length} entries`);
    allEntries.push(...entries);
  }

  // 重複を除去
  console.log('\nDeduplicating entries...');
  const uniqueEntries = deduplicateEntries(allEntries);
  console.log(`  Before: ${allEntries.length}, After: ${uniqueEntries.length} (removed ${allEntries.length - uniqueEntries.length} duplicates)`);

  // elapsed_msを再計算してマージ
  console.log('\nMerging with elapsed_ms recalculation...');
  let mergedEntries = recalculateElapsedMs(uniqueEntries);

  // --keep-originalオプションが指定されていない場合、original_elapsed_msを削除
  if (!keepOriginalElapsed) {
    mergedEntries = mergedEntries.map(e => {
      const { original_elapsed_ms, ...rest } = e;
      return rest;
    });
  }

  // 統計情報を表示
  printStats(allFiles, mergedEntries);

  // ファイルに書き出し
  if (dryRun) {
    console.log('\n[Dry run] Would write to:', outputFile);
    console.log('Sample entries:');
    mergedEntries.slice(0, 3).forEach((e, i) => {
      console.log(`  ${i + 1}. elapsed_ms=${e.elapsed_ms}, event=${e.event}, session=${e.session_id}`);
    });
  } else {
    writeJsonlFile(outputFile, mergedEntries);
    console.log(`\nMerged output written to: ${outputFile}`);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
