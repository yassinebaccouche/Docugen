import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { TemplateError } from "./docx-template";

const MAX_SPREADSHEET_SIZE = 10 * 1024 * 1024;

interface SpreadsheetRecord {
  rowNumber: number;
  cells: string[];
}

interface SpreadsheetData {
  records: string[][];
  rowNumbers: number[];
}

function normalizeHeader(header: string): string {
  return header.trim().toLocaleLowerCase("fr");
}

function formatCell(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("result" in value) return formatCell(value.result as ExcelJS.CellValue);
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("");
  }
  return "";
}

function validateHeaders(headers: string[], placeholders: string[]): Map<string, number> {
  if (headers.length === 0 || headers.every((header) => !header.trim())) {
    throw new TemplateError("La première ligne du tableau doit contenir les noms des champs.");
  }

  const indexes = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return;
    if (indexes.has(normalized)) {
      throw new TemplateError(`Le nom de colonne « ${header} » apparaît plusieurs fois.`);
    }
    indexes.set(normalized, index);
  });

  const missing = placeholders.filter((name) => !indexes.has(normalizeHeader(name)));
  if (missing.length > 0) {
    throw new TemplateError(
      `Ajoutez une colonne pour chaque champ du modèle : ${missing.join(", ")}.`,
    );
  }

  return indexes;
}

function readWorkbookData(
  workbook: ExcelJS.Workbook,
  placeholders: string[],
): SpreadsheetData {
  let bestMatch: {
    headers: string[];
    rows: SpreadsheetRecord[];
    rowNumber: number;
    matchedPlaceholders: number;
  } | null = null;

  // Scan every non-empty row and worksheet so cover sheets and tables below row 1 are supported.
  for (const worksheet of workbook.worksheets) {
    const worksheetRows: SpreadsheetRecord[] = [];
    let columnCount = worksheet.columnCount;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      columnCount = Math.max(columnCount, row.cellCount);
      worksheetRows.push({
        rowNumber,
        cells: Array.from({ length: row.cellCount }, (_, index) =>
          formatCell(row.getCell(index + 1).value),
        ),
      });
    });

    for (let headerIndex = 0; headerIndex < worksheetRows.length; headerIndex += 1) {
      const headerRow = worksheetRows[headerIndex];
      const headers = Array.from({ length: columnCount }, (_, index) =>
        headerRow.cells[index] ?? "",
      );
      const normalizedHeaders = new Set(
        headers.map((header) => normalizeHeader(header)).filter(Boolean),
      );
      const matchedPlaceholders = placeholders.filter((placeholder) =>
        normalizedHeaders.has(normalizeHeader(placeholder)),
      ).length;
      const rows = worksheetRows.slice(headerIndex + 1);

      // The first row containing every template field is the table header; preserve all columns.
      if (matchedPlaceholders === placeholders.length && rows.length > 0) {
        return {
          records: [headers, ...rows.map((row) => row.cells)],
          rowNumbers: [headerRow.rowNumber, ...rows.map((row) => row.rowNumber)],
        };
      }

      if (!bestMatch || matchedPlaceholders > bestMatch.matchedPlaceholders) {
        bestMatch = {
          headers,
          rows,
          rowNumber: headerRow.rowNumber,
          matchedPlaceholders,
        };
      }
    }
  }

  if (!bestMatch) {
    return { records: [], rowNumbers: [] };
  }

  return {
    records: [
      bestMatch.headers,
      ...bestMatch.rows.map((row) => row.cells),
    ],
    rowNumbers: [
      bestMatch.rowNumber,
      ...bestMatch.rows.map((row) => row.rowNumber),
    ],
  };
}

/**
 * Maps each non-empty spreadsheet data row to values keyed by DOCX placeholder.
 */
export async function readSpreadsheetRows(
  file: File,
  placeholders: string[],
): Promise<Record<string, string>[]> {
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "xlsx" && extension !== "csv") {
    throw new TemplateError("Choisissez un tableau au format .xlsx ou .csv.");
  }
  if (file.size === 0 || file.size > MAX_SPREADSHEET_SIZE) {
    throw new TemplateError("Le tableau est vide ou dépasse la limite de 10 Mo.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const records: string[][] = [];
  let rowNumbers: number[] = [];

  try {
    if (extension === "csv") {
      const firstLine = bytes.toString("utf8").split(/\r?\n/, 1)[0] ?? "";
      const delimiter = [",", ";", "\t"].sort(
        (left, right) =>
          firstLine.split(right).length - firstLine.split(left).length,
      )[0];
      records.push(
        ...(parse(bytes, {
          bom: true,
          delimiter,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: false,
        }) as string[][]),
      );
      rowNumbers = records.map((_, index) => index + 1);
    } else {
      const workbook = new ExcelJS.Workbook();
      const workbookBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(workbookBuffer).set(bytes);
      await workbook.xlsx.load(workbookBuffer);
      const spreadsheetData = readWorkbookData(workbook, placeholders);
      records.push(...spreadsheetData.records);
      rowNumbers = spreadsheetData.rowNumbers;
    }
  } catch (error) {
    if (error instanceof TemplateError) throw error;
    throw new TemplateError(
      "Impossible de lire ce tableau. Vérifiez le format et la ligne d’en-têtes.",
    );
  }

  if (records.length < 2) {
    throw new TemplateError("Ajoutez au moins une ligne de données sous les en-têtes.");
  }

  const headers = records[0].map((header) => header.trim());
  const indexes = validateHeaders(headers, placeholders);
  const rows = records.slice(1);
  const generatedRows: Record<string, string>[] = [];

  rows.forEach((row, index) => {
    if (row.every((value) => !value.trim())) return;
    const values: Record<string, string> = {};
    for (const placeholder of placeholders) {
      const value = row[indexes.get(normalizeHeader(placeholder)) ?? -1]?.trim() ?? "";
      if (!value) {
        throw new TemplateError(
          `La ligne ${rowNumbers[index + 1] ?? index + 2} ne contient pas de valeur pour « ${placeholder} ».`,
        );
      }
      values[placeholder] = value;
    }

    if (Object.values(values).some(Boolean)) {
      generatedRows.push(values);
    }
  });

  if (generatedRows.length === 0) {
    throw new TemplateError("Le tableau ne contient aucune ligne à générer.");
  }

  return generatedRows;
}
