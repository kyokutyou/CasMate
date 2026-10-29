import { readFileSync } from 'node:fs';
import ts from 'typescript';

export function assertSameTestFiles(actual, expected) {
  const sorted = files => [...files].sort();
  if (new Set(actual).size !== actual.length || JSON.stringify(sorted(actual)) !== JSON.stringify(sorted(expected))) {
    throw new Error('Test file scope changed: missing, duplicate, or unexpected files.');
  }
}

export function groupTestFiles(files) {
  if (!files.length) throw new Error('No test files selected.');
  assertSameTestFiles(files, [...new Set(files)]);
  const groups = { light: [], render: [] };
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const imports = ts.preProcessFile(source, true, true).importedFiles;
    const rendering = imports.some(({ fileName }) => /\/helpers\/electron-fixture(?:\.[cm]?[jt]s)?$/u.test(fileName))
      || /^\s*\/\/\s*@casmate-rendering\b/mu.test(source);
    groups[rendering ? 'render' : 'light'].push(file);
  }
  assertSameTestFiles([...groups.light, ...groups.render], files);
  return groups;
}
