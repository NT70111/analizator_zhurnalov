if (!process.env.NODE_TEST_CONTEXT) {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, ['--test', __filename], { encoding: 'utf8' });
    if (result.error) {
        console.error(`Не удалось запустить тесты: ${result.error.message}`);
        process.exit(1);
    }
}

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { parseArgs, parseLogLine, readLogFile } = require('../parse');

const temporaryDirectories = [];

async function createLogFile(contents) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'log-parser-test-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'test.log');
    await fs.writeFile(filePath, contents, 'utf8');
    return filePath;
}

after(async () => {
    await Promise.all(
        temporaryDirectories.map((directory) =>
            fs.rm(directory, { recursive: true, force: true })
        )
    );
});

test('разбирает корректную запись и удаляет пробелы по краям полей', () => {
    assert.deepEqual(
        parseLogLine('  2026-10-01T10:00:00Z | INFO | api | EVT-1 | started  '),
        {
            valid: true,
            event: {
                timestamp: '2026-10-01T10:00:00Z',
                level: 'INFO',
                source: 'api',
                eventCode: 'EVT-1',
                message: 'started'
            }
        }
    );
});

test('принимает дробные секунды и смещение часового пояса', () => {
    assert.equal(
        parseLogLine('2026-10-01T10:00:00.123+03:00|DEBUG|api|EVT-2|message').valid,
        true
    );
});

test('отклоняет пустую строку', () => {
    assert.equal(parseLogLine('   ').reason, 'empty line');
});

test('отклоняет строку с неверным числом полей', () => {
    assert.equal(parseLogLine('2026-10-01T10:00:00Z|INFO|api').reason, 'invalid field count');
});

test('отклоняет запись с незаполненным обязательным полем', () => {
    assert.equal(
        parseLogLine('2026-10-01T10:00:00Z|INFO||EVT-1|message').reason,
        'empty required field'
    );
});

test('отклоняет неподдерживаемый уровень журнала', () => {
    assert.equal(
        parseLogLine('2026-10-01T10:00:00Z|FATAL|api|EVT-1|message').reason,
        'invalid log level'
    );
});

test('отклоняет неверный формат и невозможную дату', () => {
    assert.equal(
        parseLogLine('not-a-timestamp|INFO|api|EVT-1|message').reason,
        'invalid timestamp'
    );
    assert.equal(
        parseLogLine('2026-02-32T10:00:00Z|INFO|api|EVT-1|message').reason,
        'invalid timestamp'
    );
});

test('разбирает параметры и приводит формат вывода к нижнему регистру', () => {
    assert.deepEqual(
        parseArgs([
            '--input', 'events.log',
            '--from', '2026-10-01T00:00:00Z',
            '--to', '2026-10-02T00:00:00Z',
            '--level', 'INFO',
            '--source', 'api',
            '--format', 'JSON',
            '--output', 'report'
        ]),
        {
            input: 'events.log',
            from: '2026-10-01T00:00:00Z',
            to: '2026-10-02T00:00:00Z',
            level: 'INFO',
            source: 'api',
            format: 'json',
            output: 'report'
        }
    );
});

test('сообщает об отсутствии обязательного параметра --input', () => {
    assert.throws(() => parseArgs([]), /Required argument: --input/);
});

test('отклоняет неизвестный параметр', () => {
    assert.throws(() => parseArgs(['--input', 'events.log', '--unknown', 'value']), /Unknown argument/);
});

test('отклоняет параметр без значения', () => {
    assert.throws(() => parseArgs(['--input']), /Missing value for argument: --input/);
    assert.throws(() => parseArgs(['--input', 'events.log', '--level', '--source']), /Missing value for argument: --level/);
});

test('отклоняет повторяющийся параметр', () => {
    assert.throws(
        () => parseArgs(['--input', 'first.log', '--input', 'second.log']),
        /Duplicate argument: --input/
    );
});

test('отклоняет неподдерживаемый формат файла', () => {
    assert.throws(
        () => parseArgs(['--input', 'events.log', '--format', 'xml']),
        /Invalid --format value/
    );
});

test('считает корректные и некорректные строки и записывает номера некорректных', async () => {
    const filePath = await createLogFile([
        '2026-10-01T10:00:00Z|INFO|api|EVT-1|one',
        'invalid row',
        '2026-10-01T11:00:00Z|ERROR|worker|EVT-2|two',
        '',
        '2026-10-01T12:00:00Z|INFO|worker|EVT-3|three'
    ].join('\n'));

    assert.deepEqual(await readLogFile(filePath), {
        summary: {
            validRows: 3,
            invalidRows: 2,
            matchedRows: 3
        },
        matchedEvents: [
            {
                timestamp: '2026-10-01T10:00:00Z',
                level: 'INFO',
                source: 'api',
                eventCode: 'EVT-1',
                message: 'one',
                lineNumber: 1
            },
            {
                timestamp: '2026-10-01T11:00:00Z',
                level: 'ERROR',
                source: 'worker',
                eventCode: 'EVT-2',
                message: 'two',
                lineNumber: 3
            },
            {
                timestamp: '2026-10-01T12:00:00Z',
                level: 'INFO',
                source: 'worker',
                eventCode: 'EVT-3',
                message: 'three',
                lineNumber: 5
            }
        ],
        invalidLineNumbers: [2, 4]
    });
});

test('применяет фильтры уровня и источника, сохраняя общую статистику', async () => {
    const filePath = await createLogFile([
        '2026-10-01T10:00:00Z|INFO|api|EVT-1|one',
        'bad row',
        '2026-10-01T11:00:00Z|ERROR|api|EVT-2|two',
        '2026-10-01T12:00:00Z|INFO|worker|EVT-3|three'
    ].join('\n'));

    const report = await readLogFile(filePath, { level: 'INFO', source: 'api' });

    assert.deepEqual(report.summary, {
        validRows: 3,
        invalidRows: 1,
        matchedRows: 1
    });
    assert.deepEqual(report.matchedEvents.map((event) => event.lineNumber), [1]);
    assert.deepEqual(report.invalidLineNumbers, [2]);
});

test('включает граничное время начала и исключает граничное время окончания', async () => {
    const filePath = await createLogFile([
        '2026-10-01T10:00:00Z|INFO|api|EVT-1|before',
        '2026-10-01T11:00:00Z|INFO|api|EVT-2|from boundary',
        '2026-10-01T12:00:00Z|INFO|api|EVT-3|to boundary'
    ].join('\n'));

    const report = await readLogFile(filePath, {
        from: '2026-10-01T11:00:00Z',
        to: '2026-10-01T12:00:00Z'
    });

    assert.equal(report.summary.validRows, 3);
    assert.equal(report.summary.matchedRows, 1);
    assert.deepEqual(report.matchedEvents.map((event) => event.lineNumber), [2]);
});

test('отклоняет неверные значения фильтров времени начала и окончания', async () => {
    const filePath = await createLogFile('2026-10-01T10:00:00Z|INFO|api|EVT-1|one');

    await assert.rejects(readLogFile(filePath, { from: 'not-a-date' }), /Invalid from filter timestamp/);
    await assert.rejects(readLogFile(filePath, { to: 'not-a-date' }), /Invalid to filter timestamp/);
});

test('сообщает об ошибке при чтении пустого файла журнала', async () => {
    await assert.rejects(
        readLogFile(path.join(__dirname, '..', 'logs', 'empty_logs.log')),
        /file is empty/
    );
});

test('сообщает об ошибке, если файл журнала не найден', async () => {
    await assert.rejects(
        readLogFile(path.join(os.tmpdir(), 'missing-log-parser-test-file.log')),
        { code: 'ENOENT' }
    );
});
