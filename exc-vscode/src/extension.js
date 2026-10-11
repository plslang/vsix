// src/extension.js - basic diagnostics + completions for .pla files
const vscode = require('vscode');

let diagnosticCollection;

// ── что показывать в подсказках ──
const DIRECTIVES = [
    { label: '@ifblock',    detail: 'open an if-block',     doc: 'Начало блока if/else if/else. Закрывается @endblock.' },
    { label: '@whileblock', detail: 'open a while-block',   doc: 'Начало блока while. Закрывается @endblock.' },
    { label: '@endblock',   detail: 'close a block',        doc: 'Закрывает @ifblock или @whileblock.' },
    { label: '@synthetic',  detail: 'reserved directive',   doc: 'Зарезервировано на будущее.' },
    { label: '@inline',     detail: 'reserved directive',   doc: 'Зарезервировано на будущее.' },
    { label: '@override',   detail: 'reserved directive',   doc: 'Зарезервировано на будущее.' },
    { label: '@deprecated', detail: 'reserved directive',   doc: 'Зарезервировано на будущее.' }
];

const KEYWORDS = [
    { label: 'using',    detail: 'import module',         doc: 'using math' },
    { label: 'global',   detail: 'global variable',       doc: 'global int x = 0' },
    { label: 'declare',  detail: 'declare parameter',     doc: 'declare int x' },
    { label: 'int',      detail: 'integer type',          doc: 'int x = 0' },
    { label: 'string',   detail: 'string type',           doc: 'string s = "hi"' },
    { label: 'bool',     detail: 'boolean type',          doc: 'bool b = 1' },
    { label: 'if',       detail: 'conditional',           doc: 'if cond:' },
    { label: 'else',     detail: 'else branch',           doc: 'else:' },
    { label: 'else if',  detail: 'else-if branch',        doc: 'else if cond:' },
    { label: 'while',    detail: 'while loop',            doc: 'while cond:' },
    { label: 'pass',     detail: 'break out of the loop', doc: 'pass' },
    { label: 'continue', detail: 'next loop iteration',   doc: 'continue' },
    { label: 'return',   detail: 'return from function',  doc: 'return expr' },
    { label: 'print',    detail: 'print without newline', doc: 'print(expr)' },
    { label: 'println',  detail: 'print with newline',    doc: 'println(expr)' },
    { label: 'cin',      detail: 'read one word',         doc: 'cin(var)' },
    { label: 'cinline',  detail: 'read whole line',       doc: 'cinline(var)' },
    { label: 'exit',     detail: 'exit program',          doc: 'exit(N)' }
];

const TYPES = [
    { label: '!void', detail: 'void return type', doc: 'func(!void):' },
    { label: '!bool', detail: 'bool return type', doc: 'func(!bool):' },
    { label: '!int',  detail: 'int return type',  doc: 'func(!int):' }
];

// ── провайдер автодополнения ──
const completionProvider = {
    provideCompletionItems(document, position, token, context) {
        const lineText = document.lineAt(position.line).text;
        const before = lineText.substring(0, position.character);

        const items = [];

        // если перед курсором @ — показываем директивы
        if (/@\w*$/.test(before) || before.endsWith('@')) {
            for (const d of DIRECTIVES) {
                const item = new vscode.CompletionItem(
                    d.label, vscode.CompletionItemKind.Keyword);
                item.detail = d.detail;
                item.documentation = new vscode.MarkdownString(d.doc);
                const atIdx = before.lastIndexOf('@');
                if (atIdx >= 0) {
                    item.range = new vscode.Range(
                        position.line, atIdx,
                        position.line, position.character
                    );
                }
                items.push(item);
            }
            return items;
        }

        // если перед курсором ! (внутри (!type)) — показываем типы
        if (/!\w*$/.test(before)) {
            for (const t of TYPES) {
                const item = new vscode.CompletionItem(
                    t.label, vscode.CompletionItemKind.TypeParameter);
                item.detail = t.detail;
                item.documentation = new vscode.MarkdownString(t.doc);
                const bangIdx = before.lastIndexOf('!');
                if (bangIdx >= 0) {
                    item.range = new vscode.Range(
                        position.line, bangIdx,
                        position.line, position.character
                    );
                }
                items.push(item);
            }
            return items;
        }

        // общие ключевые слова — показываем только если строка не пустая
        const trimmed = before.trim();
        if (trimmed.length === 0 || /^[a-zA-Z_]*$/.test(trimmed)) {
            for (const k of KEYWORDS) {
                const item = new vscode.CompletionItem(
                    k.label, vscode.CompletionItemKind.Keyword);
                item.detail = k.detail;
                item.documentation = new vscode.MarkdownString(k.doc);
                items.push(item);
            }
        }

        return items;
    }
};

// ── диагностика ──
function activate(context) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('pla');
    context.subscriptions.push(diagnosticCollection);

    const triggerChars = ['@', '!', ' '];
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'pla', completionProvider, ...triggerChars
        )
    );

    vscode.workspace.onDidOpenTextDocument(doc => {
        if (doc.languageId === 'pla') updateDiagnostics(doc);
    }, null, context.subscriptions);

    let timer = null;
    vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.languageId !== 'pla') return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => updateDiagnostics(e.document), 300);
    }, null, context.subscriptions);

    vscode.workspace.onDidSaveTextDocument(doc => {
        if (doc.languageId === 'pla') updateDiagnostics(doc);
    }, null, context.subscriptions);

    vscode.workspace.onDidCloseTextDocument(doc => {
        diagnosticCollection.delete(doc.uri);
    }, null, context.subscriptions);

    vscode.workspace.textDocuments.forEach(doc => {
        if (doc.languageId === 'pla') updateDiagnostics(doc);
    });
}

function updateDiagnostics(document) {
    const diagnostics = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i;
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('--')) continue;

        // ── незакрытая строка ──
        const quoteCount = (line.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            if (!line.includes('\\"')) {
                addDiag(diagnostics, document, lineNum, line.indexOf('"'),
                    "unterminated string literal",
                    vscode.DiagnosticSeverity.Error, 'E10');
            }
        }

        // ── '=' вместо '==' в условии if/while ──
        if ((trimmed.startsWith('if ') || trimmed.startsWith('while '))
            && /[^=!<>]=[^=]/.test(trimmed)) {
            const match = trimmed.match(/[^=!<>](=)[^=]/);
            if (match) {
                addDiag(diagnostics, document, lineNum, line.indexOf(match[1]),
                    "did you mean '=='? '=' is assignment, not comparison",
                    vscode.DiagnosticSeverity.Error, 'E63');
            }
        }
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

function addDiag(diagnostics, document, line, col, message, severity, code) {
    const range = new vscode.Range(
        new vscode.Position(line, col),
        new vscode.Position(line, col + 100)
    );
    const diag = new vscode.Diagnostic(range, message, severity);
    diag.source = 'pla';
    diag.code = code;
    diagnostics.push(diag);
}

function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}

module.exports = {
    activate,
    deactivate
};