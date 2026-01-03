import { unzipSync } from 'fflate';
import iconv from 'iconv-lite';
import type { Env } from '../types';

const EDINET_CODE_LIST_URL =
  'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip';

interface EdinetCodeRow {
  edinetCode: string;
  submitterType: string;
  listingStatus: string;
  consolidated: string;
  capital: string;
  fiscalYearEnd: string;
  name: string;
  nameEn: string;
  nameKana: string;
  address: string;
  industry: string;
  stockCode: string;
  corporateNumber: string;
}

function parseCSV(csvText: string): EdinetCodeRow[] {
  const lines = csvText.split('\n');
  // Skip first line (metadata) and second line (header)
  const dataLines = lines.slice(2);

  const rows: EdinetCodeRow[] = [];

  for (const line of dataLines) {
    if (!line.trim()) continue;

    // Parse CSV with quoted fields
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current);

    if (fields.length >= 13) {
      rows.push({
        edinetCode: fields[0],
        submitterType: fields[1],
        listingStatus: fields[2],
        consolidated: fields[3],
        capital: fields[4],
        fiscalYearEnd: fields[5],
        name: fields[6],
        nameEn: fields[7],
        nameKana: fields[8],
        address: fields[9],
        industry: fields[10],
        stockCode: fields[11],
        corporateNumber: fields[12],
      });
    }
  }

  return rows;
}

export async function updateStockList(env: Env): Promise<{ updated: number; total: number }> {
  // Fetch the ZIP file
  const response = await fetch(EDINET_CODE_LIST_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch EDINET code list: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const zipData = new Uint8Array(arrayBuffer);

  // Unzip
  const unzipped = unzipSync(zipData);
  const csvFileName = Object.keys(unzipped).find((name) => name.endsWith('.csv'));
  if (!csvFileName) {
    throw new Error('CSV file not found in ZIP');
  }

  // Decode from cp932 to UTF-8
  const csvBuffer = Buffer.from(unzipped[csvFileName]);
  const csvText = iconv.decode(csvBuffer, 'cp932');

  // Parse CSV
  const rows = parseCSV(csvText);

  // Filter for listed companies with valid stock codes
  const listedStocks = rows.filter(
    (row) => row.listingStatus === '上場' && row.stockCode && row.stockCode.match(/^\d{4,5}$/)
  );

  // Upsert to database in batches
  const BATCH_SIZE = 100;
  let updated = 0;

  for (let i = 0; i < listedStocks.length; i += BATCH_SIZE) {
    const batch = listedStocks.slice(i, i + BATCH_SIZE);
    const statements = batch.map((stock) =>
      env.DB.prepare(
        `INSERT INTO stocks (code, name, market, sector, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(code) DO UPDATE SET
           name = excluded.name,
           sector = excluded.sector,
           updated_at = CURRENT_TIMESTAMP`
      ).bind(stock.stockCode, stock.name, null, stock.industry)
    );

    try {
      await env.DB.batch(statements);
      updated += batch.length;
    } catch (error) {
      console.error(`Failed to upsert batch starting at ${i}:`, error);
    }
  }

  return { updated, total: listedStocks.length };
}
