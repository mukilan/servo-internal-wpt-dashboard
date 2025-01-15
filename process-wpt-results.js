import assert from 'node:assert/strict'
import chalk from 'chalk';

function is_object (val) {
    return (
        typeof val === 'object' && val !== null && val !== undefined
    )
}

export function merge_nonoverlap (obj1, obj2) {
    function checkNoArray (obj) {
        for (const [k, v] of Object.entries(obj)) {
            assert(!Array.isArray(v), `Key ${k} - arrays can't be merged`)
            if (is_object(v)) {
                checkNoArray(v)
            }
        }
        return obj
    }

    checkNoArray(obj1)
    const result = obj1
    for (const [k, v] of Object.entries(obj2)) {
        if (is_object(v)) {
            if (result[k] === undefined) {
                result[k] = checkNoArray(v)
            } else {
                assert(is_object(result[k]), `Key ${k} is not an object`)
                result[k] = merge_nonoverlap(obj1[k], v)
            }
        } else {
            assert(!Array.isArray(v), `Key ${k} - arrays can't be merged`)
            assert(!(k in obj1), `Key ${k} overlaps`)
            result[k] = v
        }
    }
    return result
}

export function process_raw_results (raw_results) {
    const test_scores = {}
    const run_info = raw_results.run_info

    for (const test of raw_results.results) {
        const test_name = test.test
        const test_status = test.status

        const test_score = {
            score: test_status === 'PASS' ? 1 : 0,
            subtests: {}
        }

        test_scores[test_name] = test_score

        for (const subtest of test.subtests) {
            test_score.subtests[subtest.name] = {
                score: subtest.status === 'PASS' ? 1 : 0
            }
        }
    }

    return { run_info, test_scores }
}

export function focus_areas_map (run) {
    const map = {}
    for (const test of Object.keys(run.test_scores)) {
        map[test] = []
        for (const [area_key, area] of Object.entries(FOCUS_AREAS)) {
            if (area.predicate(test)) {
                map[test].push(area_key)
            }
        }
    }
    return map
}

function regex_predicate (exp) {
    return test_name => exp.test(test_name)
}

function prefix_predicate (prefix) {
    return test_name => test_name.startsWith(prefix)
}

const CSS2_FOCUS_FOLDERS = [
    'abspos',
    'box-display',
    'floats',
    'floats-clear',
    'linebox',
    'margin-padding-clear',
    'normal-flow',
    'positioning'
]

const CSS_TABLES_PREDICATE = /^\/css\/(CSS2\/tables|css-tables)\//

const FOCUS_AREAS = {
    all: {
        name: 'All WPT tests',
        predicate: prefix_predicate(''),
        order: 0
    },
    css: {
        name: '/css',
        predicate: prefix_predicate('/css/'),
        order: 1
    },
    css2: {
        name: '/css/CSS2',
        predicate: prefix_predicate('/css/CSS2/'),
        order: 2
    },
    csstable: {
        name: '/css/CSS2/tables & /css/css-tables',
        predicate: regex_predicate(CSS_TABLES_PREDICATE),
        order: 90
    },
    cssom: {
        name: '/css/cssom',
        predicate: prefix_predicate('/css/cssom/'),
        order: 91
    },
    csspos: {
        name: '/css/css-position',
        predicate: prefix_predicate('/css/css-position/'),
        order: 92
    },
    cssflex: {
        name: '/css/css-flexbox',
        predicate: prefix_predicate('/css/css-flexbox/'),
        order: 93
    },
    cssgrid: {
        name: '/css/css-grid',
        predicate: prefix_predicate('/css/css-grid/'),
        order: 94
    },
    cssalign: {
        name: '/css/css-align',
        predicate: prefix_predicate('/css/css-align/'),
        order: 95
    },
    csstext: {
        name: '/css/css-text',
        predicate: prefix_predicate('/css/css-text/'),
        order: 96
    },
    gamepad: {
        name: '/gamepad',
        predicate: prefix_predicate('/gamepad/'),
        order: 97
    },
    shadowdom: {
        name: '/shadow-dom',
        predicate: prefix_predicate('/shadow-dom/'),
        order: 98
    },
    webcryptoapi: {
        name: '/WebCryptoAPI',
        predicate: prefix_predicate('/WebCryptoAPI/'),
        order: 99
    },
    webxr: {
        name: '/webxr',
        predicate: prefix_predicate('/webxr/'),
        order: 100
    }
}

for (const [idx, folder] of CSS2_FOCUS_FOLDERS.entries()) {
    const path = `/css/CSS2/${folder}/`
    FOCUS_AREAS[folder] = {
        name: `${path}`,
        predicate: prefix_predicate(path),
        order: idx + 3
    }
}

export function get_focus_areas () {
    const area_keys = []
    const area_names = {}
    for (const [key, area] of Object.entries(FOCUS_AREAS)) {
        area_keys.push(key)
        area_names[key] = area.name
    }

    area_keys.sort((a, b) => FOCUS_AREAS[a].order - FOCUS_AREAS[b].order)
    return { area_keys, area_names }
}

export function score_run (run, against_run, focus_areas_map, print_filter) {
    const scores = {}
    for (const area of Object.keys(FOCUS_AREAS)) {
        scores[area] = {
            total_tests: 0,
            total_score: 0
        }
    }

    let testNames = Object.keys(against_run.test_scores);
    testNames.sort();
    for (const test of testNames) {
        const { subtests } = against_run.test_scores[test];
        const areas = focus_areas_map[test]

        for (const area of areas) {
            scores[area].total_tests += 1
        }

        const run_test = run.test_scores[test]

        // score new tests not present in older runs
        if (!run_test) continue

        const subtest_names = Object.keys(subtests)
        if (!subtest_names.length) {
            for (const area of areas) {
                scores[area].total_score += run_test.score
            }
            if (print_filter(test)) {
                const passes = run_test.score == 1;
                if (passes) {
                    console.log(chalk.green(`PASS ${test}`))
                } else {
                    console.log(chalk.red(`FAIL ${test}`))
                }
            }
        } else {
            let passed_test_count = 0
            for (const subtest of subtest_names) {
                if (Object.hasOwn(run_test.subtests, subtest)) {
                    passed_test_count += run_test.subtests[subtest].score
                }
            }
            const test_score = passed_test_count / subtest_names.length
            for (const area of areas) {
                scores[area].total_score += test_score
            }
            if (print_filter(test)) {
                const passes = test_score == 1;
                if (passes) {
                    console.log(chalk.green(`PASS ${test} (${passed_test_count}/${subtest_names.length})`))
                } else {
                    console.log(chalk.red(`FAIL ${test} (${passed_test_count}/${subtest_names.length})`))
                }
            }
        }
    }

    return Object.entries(scores).reduce((scores, [area, totals]) => {
        scores[area] = 0
        if (totals.total_tests !== 0) {
            scores[area] = Math.floor(
                1000 * totals.total_score / totals.total_tests
            )
        }
        return scores
    }, {})
}
