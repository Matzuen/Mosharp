import {
  clearRange,
  gridOf,
  isSingleCell,
  normalizeRange,
  rangeSize,
  rangeToTsv,
  rowCells,
  sourceLineForRow,
} from "./tableRange.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const table = [
  "| 名称 | 数量 | 备注 |",
  "| --- | :--: | --- |",
  "| 苹果 | 3 | 红 |",
  "| 梨 | 5 | 黄 |",
].join("\n");

const range = normalizeRange({ row: 2, col: 2 }, { row: 1, col: 0 });
assert(range.rowFrom === 1 && range.rowTo === 2, "rows are ordered");
assert(range.colFrom === 0 && range.colTo === 2, "columns are ordered");
assert(rangeSize(range) === 6, "size counts cells");

const single = normalizeRange({ row: 1, col: 1 }, { row: 1, col: 1 });
assert(isSingleCell(single), "a single cell is recognized");
assert(!isSingleCell(range), "a rectangle is not single");

assert(sourceLineForRow(0) === 0, "the header is line 0");
assert(sourceLineForRow(1) === 2, "body row 1 skips the delimiter line");

assert(rowCells("| a | b |")[1] === "b", "cells are split");
assert(rowCells("| a \\| b | c |")[0] === "a | b", "escaped pipes stay in one cell");

const grid = gridOf(table);
assert(grid.header.length === 3, "header parsed");
assert(grid.rows.length === 2, "body rows skip the delimiter");
assert(grid.rows[0][0] === "苹果", "cell text parsed");

const tsv = rangeToTsv(table, { rowFrom: 1, rowTo: 2, colFrom: 0, colTo: 1 });
assert(tsv === "苹果\t3\n梨\t5", `tsv of the body block (got ${JSON.stringify(tsv)})`);

const headerTsv = rangeToTsv(table, { rowFrom: 0, rowTo: 0, colFrom: 0, colTo: 2 });
assert(headerTsv === "名称\t数量\t备注", "the header can be copied");

const cleared = clearRange(table, { rowFrom: 1, rowTo: 2, colFrom: 1, colTo: 1 });
assert(cleared.includes("| 苹果 |  | 红 |"), `the quantity column is emptied (got ${cleared})`);
assert(cleared.includes("| 梨 |  | 黄 |"), "every selected row is cleared");
assert(cleared.includes("| 名称 | 数量 | 备注 |"), "other columns are untouched");

const keepHeader = clearRange(table, { rowFrom: 0, rowTo: 2, colFrom: 0, colTo: 2 });
assert(keepHeader.includes("| 名称 | 数量 | 备注 |"), "the header is never cleared");
assert(keepHeader.includes("|  |  |  |"), "body cells are emptied");

assert(clearRange(table, { rowFrom: 9, rowTo: 9, colFrom: 0, colTo: 1 }) === table, "out of range rows are ignored");

console.log("tableRange ok");
