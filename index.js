import { opendir, readFile, writeFile } from 'node:fs/promises'
import { compress, decompress } from 'lzma-native'
import {
    merge_nonoverlap,
    process_raw_results,
    score_run,
    focus_areas_map,
    get_focus_areas
} from './process-wpt-results.js'

async function read_json_file (path) {
    const contents = await readFile(path, {
        encoding: 'utf8'
    })
    return JSON.parse(contents)
}

async function write_json_file (path, json) {
    const contents = JSON.stringify(json)
    return writeFile(path, contents)
}

async function write_compressed (path, json) {
    const string = JSON.stringify(json)
    const data = await compress(string, 9)
    return writeFile(path, data)
}

async function read_compressed (path) {
    const data = await readFile(path)
    const string = await decompress(data)
    return JSON.parse(string)
}

async function all_runs_sorted (runs_dir) {
    const dir = await opendir(`./${runs_dir}`)
    const runs = []
    for await (const run of dir) {
        runs.push(run.name)
    }

    runs.sort()
    return runs
}

async function process_chunks (path) {
    const dir = await opendir(path)
    let result = {}
    for await (const chunk of dir) {
        const chunk_run = await read_json_file(`${path}/${chunk.name}`)
        const scored_chunk = process_raw_results(chunk_run)
        if (!result.run_info) {
            const raw_run_info = scored_chunk.run_info
            const matches = raw_run_info?.browser_version?.match(/^Servo ([0-9.]+-[a-f0-9]+)?(-dirty)?$/)
            const browser_version = matches?.length === 3 ? matches[1] : 'Unknown'
            result.run_info = Object.assign(raw_run_info, { browser_version })
        }
        delete scored_chunk.run_info
        result = merge_nonoverlap(result, scored_chunk)
    }
    return result
}

async function add_run (runs_dir, chunks_dir, date) {
    const new_run = await process_chunks(chunks_dir)
    await write_compressed(`./${runs_dir}/${date}.xz`, new_run)
}

async function score_single_run (chunks_dir, print_filter) {
    const run = await process_chunks(chunks_dir)
    const test_to_areas = focus_areas_map(run)
    const { area_keys } = get_focus_areas()
    const score = score_run(run, run, test_to_areas, print_filter)
    const row = [
        ['revision', run.run_info.revision.substring(0, 9)],
        ['browser version', run.run_info.browser_version]
    ]

    for (const area of area_keys) {
        row.push([area, score[area]])
    }

    return row
}

async function recalc_scores (runs_dir) {
    console.log(`Calculating scores for ${runs_dir} directory...`)

    const scores = []
    console.log('Enumerating runs')
    const all_runs = await all_runs_sorted(runs_dir)
    const run_count = all_runs.length
    console.log('Reading latest run')
    const new_run = await read_compressed(`./${runs_dir}/${all_runs[all_runs.length - 1]}`)
    console.log('Building focus area map')
    const test_to_areas = focus_areas_map(new_run)
    const { area_keys } = get_focus_areas()
    for (const [i, r] of all_runs.entries()) {
        const [date] = r.split('.')
        console.log(`Reading run ${runs_dir}/${r} (${i}/${run_count})`)
        const run = await read_compressed(`./${runs_dir}/${r}`)
        console.log(`Calculating score for run ${runs_dir}/${r} (${i}/${run_count})`)
        const score = score_run(run, new_run, test_to_areas, () => false)
        const row = [
            date,
            run.run_info.revision.substring(0, 9),
            run.run_info.browser_version
        ]

        for (const area of area_keys) {
            row.push(score[area])
        }
        scores.push(row)
    }

    return scores
}

async function main () {
    const mode = process.argv[2]
    if (!['--add', '--recalc', '--score'].includes(mode)) {
        throw new Error(`invalid mode specified: ${mode}`)
    }

    if (mode === '--score') {
        const input_dir = process.argv[3]

        let filterStr = undefined
        if (process.argv[4] === '--filter') {
            filterStr = process.argv[5]
        }
        const result = await score_single_run(input_dir, filterStr ? name => name.includes(filterStr) : () => true)
        console.log(result)
        return
    }

    if (mode === '--add') {
        const chunks = process.argv[3]
        const date = process.argv[4]
        await add_run('runs-2020', chunks, date)
    }

    const scores = await recalc_scores('runs-2020')

    const { area_keys, area_names: focus_areas } = get_focus_areas()

    console.log('Writing site/scores.json')
    write_json_file(
        './site/scores.json', { area_keys, focus_areas, scores })

    console.log('Done')
}
main()
