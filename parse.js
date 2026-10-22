const fs = require('node:fs');
const readline = require('node:readline');

function parseLogLine(line) {
    const LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];
    if (line.trim() === '') {
        return {
            valid: false,
            reason: 'empty line',
            raw: line
        };
    }
    const splitLine = line.split('|').map((field) => field.trim());
    if (splitLine.length !== 5) {
        return {
            valid: false,
            reason: 'invalid field count',
            raw: line
        };
    }
    if (splitLine.some((field) => field === '')) {
        return {
            valid: false,
            reason: 'empty required field',
            raw: line
        };
    }
    const [timestamp, level, source, eventCode, message] = splitLine;
    if (!LEVELS.includes(level)) {
        return {
            valid: false,
            reason: 'invalid log level',
            raw: line
        };
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
        || Number.isNaN(Date.parse(timestamp))) {
        return {
            valid: false,
            reason: 'invalid timestamp',
            raw: line
        };
    }
    return {
        valid: true,
        event: {
            timestamp,
            level,
            source,
            eventCode,
            message
        }
    };
}

function parseArgs(args) {
    const allowedOptions = [
        '--input',
        '--from',
        '--to',
        '--level',
        '--source',
        '--format',
        '--output'
    ];
    const options = {};
    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        if (!allowedOptions.includes(key)) {
            throw new Error(`Unknown argument: ${key}`);
        }
        const value = args[i + 1];
        if (value === undefined || value.startsWith('--')) {
            throw new Error(`Missing value for argument: ${key}`);
        }
        const name = key.slice(2);
        if (options[name] !== undefined) {
            throw new Error(`Duplicate argument: ${key}`);
        }
        options[name] = value;
        i++;
    }

    if (!options.input) {
        throw new Error('Required argument: --input');
    }
    if (options.format !== undefined) {
        options.format = options.format.toLowerCase();
        if (!['json', 'csv'].includes(options.format)) {
            throw new Error('Invalid --format value. Expected json or csv');
        }
    }
    return options;
}

function parseFilterTimestamp(value, name) {
    if (value === undefined) {
        return undefined;
    }
    const timestamp = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    if (Number.isNaN(timestamp)) {
        throw new TypeError(`Invalid ${name} filter timestamp: ${value}`);
    }
    return timestamp;
}

async function readLogFile(filePath, filters = {}) {
    const from = parseFilterTimestamp(filters.from, 'from');
    const to = parseFilterTimestamp(filters.to, 'to');
    const stream = fs.createReadStream(filePath, {
        encoding: 'utf8'
    });
    const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
    });
    let lineNumber = 0;
    let validCount = 0;
    let invalidCount = 0;
    const matchedEvents = [];
    const invalidLineNumbers = [];
    for await (const line of rl) {
        lineNumber++;
        const result = parseLogLine(line);
        if (result.valid) {
            validCount++;
            if (filters.level !== undefined &&
                result.event.level !== filters.level) {
                continue;
            }
            if (filters.source !== undefined &&
                result.event.source !== filters.source) {
                continue;
            }
            if (from !== undefined || to !== undefined) {
                const timestamp = Date.parse(result.event.timestamp);
                if (from !== undefined && timestamp < from) {
                    continue;
                }
                if (to !== undefined && timestamp >= to) {
                    continue;
                }
            }
            matchedEvents.push({
                ...result.event,
                lineNumber
            });
        } else {
            invalidCount++;
            invalidLineNumbers.push(lineNumber);
        }
    }
    if (lineNumber !== 0) {
        return {
            summary: {
                validRows: validCount,
                invalidRows: invalidCount,
                matchedRows: matchedEvents.length
            },
            matchedEvents,
            invalidLineNumbers
        };
    }
    else{
        throw new Error('file is empty')
    }

}

module.exports = { parseLogLine, parseArgs, readLogFile };
