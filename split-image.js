#!/usr/bin/env node

import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// A4サイズ (ポイント単位: 1pt = 1/72 inch)
const A4_WIDTH_PT = 595.28;  // 210mm
const A4_HEIGHT_PT = 841.89; // 297mm

// A4サイズ (ピクセル単位: 300dpi)
const DPI = 300;
const A4_WIDTH_PX = Math.round(210 * DPI / 25.4);  // 2480px
const A4_HEIGHT_PX = Math.round(297 * DPI / 25.4); // 3508px

// 分割数
const COLS = 4;
const ROWS = 4;
const TOTAL_TILES = COLS * ROWS;

async function splitImageToPDF(inputPath, outputPath) {
  console.log(`入力画像: ${inputPath}`);
  console.log(`出力PDF: ${outputPath}`);
  console.log(`分割数: ${COLS}x${ROWS} = ${TOTAL_TILES}枚`);
  console.log(`A4サイズ: ${A4_WIDTH_PX}x${A4_HEIGHT_PX}px (${DPI}dpi)`);
  console.log('');

  // 画像を読み込んでメタデータを取得
  const image = sharp(inputPath);
  const metadata = await image.metadata();
  
  console.log(`元画像サイズ: ${metadata.width}x${metadata.height}px`);
  
  // 分割後のサイズを計算（実寸印刷のため、A4の印刷可能領域に合わせる）
  // 16分割した全体サイズ = A4 x 16枚
  const totalPrintWidth = A4_WIDTH_PX * COLS;   // 4枚横に並べた幅
  const totalPrintHeight = A4_HEIGHT_PX * ROWS; // 4枚縦に並べた高さ
  
  console.log(`印刷全体サイズ: ${totalPrintWidth}x${totalPrintHeight}px`);
  
  // 元画像を印刷サイズにリサイズ
  const resizedBuffer = await image
    .resize(totalPrintWidth, totalPrintHeight, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .toBuffer();
  
  const resizedImage = sharp(resizedBuffer);
  const resizedMetadata = await resizedImage.metadata();
  console.log(`リサイズ後: ${resizedMetadata.width}x${resizedMetadata.height}px`);
  console.log('');

  // タイルのサイズ
  const tileWidth = Math.floor(resizedMetadata.width / COLS);
  const tileHeight = Math.floor(resizedMetadata.height / ROWS);
  
  console.log(`タイルサイズ: ${tileWidth}x${tileHeight}px`);
  console.log('');

  // PDFドキュメントを作成
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0
  });
  
  const writeStream = fs.createWriteStream(outputPath);
  doc.pipe(writeStream);

  // 各タイルを処理
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const tileIndex = row * COLS + col + 1;
      console.log(`タイル ${tileIndex}/${TOTAL_TILES} を処理中... (row=${row}, col=${col})`);
      
      // 切り取り位置
      const left = col * tileWidth;
      const top = row * tileHeight;
      
      // タイルを切り出し
      const tileBuffer = await sharp(resizedBuffer)
        .extract({
          left: left,
          top: top,
          width: tileWidth,
          height: tileHeight
        })
        .png()
        .toBuffer();
      
      // 最初のページ以外は新しいページを追加
      if (tileIndex > 1) {
        doc.addPage();
      }
      
      // A4ページにタイルを配置（フルページ）
      doc.image(tileBuffer, 0, 0, {
        width: A4_WIDTH_PT,
        height: A4_HEIGHT_PT
      });
      
      // ページ番号とガイドを追加（オプション）
      doc.fontSize(8)
         .fillColor('#999999')
         .text(`${tileIndex}/${TOTAL_TILES} (row:${row+1}, col:${col+1})`, 10, A4_HEIGHT_PT - 20);
    }
  }

  doc.end();
  
  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => {
      console.log('');
      console.log(`PDF生成完了: ${outputPath}`);
      console.log(`${TOTAL_TILES}ページのPDFファイルが作成されました。`);
      console.log('');
      console.log('印刷時の注意:');
      console.log('- 実際のサイズで印刷してください（拡大縮小なし）');
      console.log('- 余白を最小に設定してください');
      console.log('- ページ番号を参考に並べてください');
      resolve();
    });
    writeStream.on('error', reject);
  });
}

// メイン処理
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('使用方法: node split-image.js <入力画像> [出力PDF]');
    console.log('');
    console.log('例:');
    console.log('  node split-image.js poster.png');
    console.log('  node split-image.js poster.jpg output.pdf');
    console.log('');
    console.log('説明:');
    console.log('  入力画像を4x4=16枚に分割し、A4サイズのPDFとして出力します。');
    console.log('  各ページをA4用紙に実寸印刷し、貼り合わせることで大きなポスターを作成できます。');
    process.exit(1);
  }
  
  const inputPath = path.resolve(args[0]);
  
  // 入力ファイルの存在確認
  if (!fs.existsSync(inputPath)) {
    console.error(`エラー: 入力ファイルが見つかりません: ${inputPath}`);
    process.exit(1);
  }
  
  // 出力パスを決定
  const outputPath = args[1] 
    ? path.resolve(args[1])
    : inputPath.replace(/\.[^.]+$/, '_split.pdf');
  
  try {
    await splitImageToPDF(inputPath, outputPath);
  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    process.exit(1);
  }
}

main();
