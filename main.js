const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { parseArgs, readLogFile } = require('./parse');

function printReport(report) {
    console.log('\nSummary:');
    console.log('Valid rows (entire file):', report.summary.validRows);
    console.log('Invalid rows (entire file):', report.summary.invalidRows);
    console.log('Matched rows', report.summary.matchedRows);
    console.log('\nInvalid rows in entire file (line numbers):');
    console.log(
        report.invalidLineNumbers.length > 0
            ? report.invalidLineNumbers.join(', ')
            : 'None'
    );
    console.log('\nMatched events:');
    console.table(report.matchedEvents);
}

function formatCsv(report) {
    const columns = [
        'timestamp',
        'level',
        'source',
        'eventCode',
        'message',
        'lineNumber'
    ];
    const escapeCsvValue = (value) => {
        const text = String(value ?? '');
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
        columns.join(','),
        ...report.matchedEvents.map((event) =>
            columns.map((column) => escapeCsvValue(event[column])).join(',')
        )
    ].join('\r\n') + '\r\n';
}

function getOutputPath(output, format) {
    const extension = path.extname(output);
    const outputWithoutExtension = extension
        ? output.slice(0, -extension.length)
        : output.replace(/\.$/, '');
    return `${outputWithoutExtension}.${format}`;
}

async function writeReport(report, options) {
    if (options.format === undefined || options.output === undefined) {
        return;
    }
    const outputPath = getOutputPath(options.output, options.format);
    const content = options.format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatCsv(report);
    try {
        await fs.promises.writeFile(outputPath, content, {
            encoding: 'utf8',
            flag: 'wx'
        });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
        if (!await confirmOverwrite(outputPath)) {
            return;
        }
        await fs.promises.writeFile(outputPath, content, 'utf8');
    }
}

async function confirmOverwrite(filePath) {
    const terminal = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    try {
        const answer = await terminal.question(
            `rewrite the ${path.basename(filePath)}? (y/yes)`
        );
        return ['y', 'yes'].includes(answer.trim().toLowerCase());
    } finally {
        terminal.close();
    }
}

// -------------------------------------------------------------------

async function main(args) {
    const options = parseArgs(args);
    const filters = {
        from: options.from,
        to: options.to,
        level: options.level,
        source: options.source
    };
    const report = await readLogFile(options.input, filters);
    printReport(report);
    await writeReport(report, options);
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    printReport,
    formatCsv,
    getOutputPath,
    writeReport,
    confirmOverwrite,
    main
};