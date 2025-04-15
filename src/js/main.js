import Chart from "chart.js/auto"
import "chartjs-adapter-luxon"
import copyToClipboard from "copy-to-clipboard"
import lzstring from "lz-string"

import cases from "../data/cases.json"

const DAY_MS = 864e5  // 1 day in milliseconds


const PALETTE = [
    '#4c72b0',
    '#dd8452',
    '#55a868',
    '#c44e52',
    '#8172b3',
    '#937860',
    '#da8bc3',
    '#8c8c8c',
    '#ccb974',
    '#64b5cd'
]
const colorCache = new Map()
function getStableColor(key) {
    if (!colorCache.has(key)) {
        colorCache.set(key, PALETTE[colorCache.size % PALETTE.length])
    }
    return colorCache.get(key)
}


const allData = new Map()
let stepDefs = null
let metricDefs = null
let runInfos = null

class Selector extends EventTarget {
    constructor(parentId, isOneHot, initialSelection) {
        super()
        const div = document.getElementById(parentId)
        this._isOneHot = isOneHot
        this._list = div.querySelector("#panel-body")
        this._buttons = new Map()
        this._selected = new Set(initialSelection)

        const selectAllButton = div.querySelector("#select-all")
        if (selectAllButton != null) {
            selectAllButton.title = "Select all items"
            selectAllButton.onclick = () => this.selectAll()
        }

        const selectNoneButton = div.querySelector("#select-none")
        if (selectNoneButton != null) {
            selectNoneButton.title = "Deselect all items"
            selectNoneButton.onclick = () => this.selectNone()
        }
    }

    selectAll() {
        if (this._isOneHot) {
            console.error("Error: selectAll called on oneHot selector")
            return
        }
        // Select everyting
        this._selected.clear()
        this._buttons.forEach((button, name) => {
            button.setAttribute("class", "toggle-on")
            this._selected.add(name)
        })
        // Dispatch change event
        this.dispatchEvent(new Event("changed"))
    }

    selectNone() {
        if (this._isOneHot) {
            console.error("Error: selectNone called on oneHot selector")
            return
        }
        // Select nothing
        this._selected.clear()
        this._buttons.forEach((button) => {
            button.setAttribute("class", "toggle-off")
        })
        // Dispatch change event
        this.dispatchEvent(new Event("changed"))
    }

    #selectMultipleButtons(buttons) {
        if (this._isOneHot) {
            if (buttons.length != 1) {
                console.error("#selectMultipleButtons called on oneHot selector with >1 values")
                return
            }
            // Clear current selection, turn off all buttons
            this._selected.clear()
            for (const btn of this._buttons.values()) {
                btn.setAttribute("class", "toggle-off")
            }
        }
        for (const button of buttons) {
            // This button is now on
            button.setAttribute("class", "toggle-on")
            this._selected.add(button.textContent)
        }
        this.dispatchEvent(new Event("changed"))
    }

    #deselectMultipleButtons(buttons) {
        if (this._isOneHot) {
            console.error("#deselectMultipleButtons called on oneHot selector")
            return
        }
        for (const button of buttons) {
            // This button is now off
            button.setAttribute("class", "toggle-off")
            this._selected.delete(button.textContent)
        }
        this.dispatchEvent(new Event("changed"))
    }

    selectMultiple(strs) {
        console.log(strs)
        this.#selectMultipleButtons(strs.map((str) => this._buttons.get(str)))
    }

    select(str) {
        this.selectMultiple([str])
    }

    selected() {
        return new Set(this._buttons.keys().filter((x) => this._selected.has(x)))
    }

    addToggle(label, sorted, tooltip = "") {
        if (this._buttons.has(label)) return;

        // Create 'button' element
        const button = document.createElement("button")
        button.append(label)
        button.setAttribute("type", "button")
        // Set initial state based on previous selection
        if (this._selected.has(label)) {
            button.setAttribute("class", "toggle-on")
        } else {
            button.setAttribute("class", "toggle-off")
        }
        if (tooltip != "") button.title = tooltip
        this._buttons.set(label, button)

        // Add clicked event handler
        if (this._isOneHot) {
            button.onclick = () => this.#selectMultipleButtons([button])
        } else {
            button.onclick = () => {
                if (!this._selected.has(button.textContent)) {
                    this.#selectMultipleButtons([button])
                } else {
                    this.#deselectMultipleButtons([button])
                }
            }
        }

        if (sorted) {
            // Insert 'button' under 'parent' in sorted position
            for (const child of this._list.children) {
                if (child.textContent > label) {
                    child.before(button)
                    break
                }
            }
        }
        if (!button.parentNode) this._list.append(button)

        // Dispatch change event
        this.dispatchEvent(new Event("changed"))
    }

    removeToggles() {
        this._list.replaceChildren()
        this._buttons.clear()
        // Dispatch change event
        this.dispatchEvent(new Event("changed"))
    }
}

const dateSelector = new Selector("date-list", true, ["Past 14 Days"])
dateSelector.addEventListener("changed", updateDateRange)

const optionSelector = new Selector("option-list", false, ["Normalize"])
optionSelector.addEventListener("changed", updateCharts)

const caseSelector = new Selector("case-list", false, [
    "NVDLA:default:gnet",
    "OpenTitan:default:sha",
    "OpenPiton:1x1:dhry",
    "OpenPiton:2x2:fib",
    "OpenPiton:4x4:token",
    "VeeR-EH1:default:cmark",
    "VeeR-EH2:default:cmark_iccm_mt",
    "VeeR-EL2:default:dhry",
    "Vortex:mini:sgemm",
    "Vortex:sane:saxpy",
    "XiangShan:mini-chisel3:microbench",
    "XiangShan:mini-chisel6:cmark",
    "XuanTie-C906:default:cmark",
    "XuanTie-C910:default:memcpy",
    "XuanTie-E902:default:memcpy",
    "XuanTie-E906:default:cmark"
])
caseSelector.addEventListener("changed", updateRunSelector)

const runSelector = new Selector("run-list", false, ["gcc"])
runSelector.addEventListener("changed", updateSMSelector)

const smSelector = new Selector("step-metric-list", false, ["execute / speed", "verilate / elapsed"])
smSelector.addEventListener("changed", updateCharts)

function updateRunSelector() {
    runSelector.removeToggles()
    const selectedCases = caseSelector.selected()
    for (const caseName of allData.keys()) {
        if (!selectedCases.has(caseName)) continue
        const caseData = allData.get(caseName)
        for (const runName in caseData) {
            runSelector.addToggle(runName, true)
        }
    }
}

function updateSMSelector() {
    smSelector.removeToggles()
    const selectedCases = caseSelector.selected()
    const selectedRuns = runSelector.selected()
    for (const caseName of allData.keys()) {
        if (!selectedCases.has(caseName)) continue
        const caseData = allData.get(caseName)
        for (const runName in caseData) {
            if (!selectedRuns.has(runName)) continue
            const runData = caseData[runName]
            for (const stepName in runData) {
                const stepData = runData[stepName]
                for (const metricName in stepData) {
                    const hint =
                    `'${stepName}' step: ${stepDefs[stepName].description}`
                    + "\n"
                    + `'${metricName}' metric: ${metricDefs[metricName].description}`
                    smSelector.addToggle(`${stepName} / ${metricName}`, true, hint)
                }
            }
        }
    }
}

const charts = new Map()
function getChart(stepName, metricName) {
    const smName = `${stepName} / ${metricName}`
    if (charts.has(smName)) return charts.get(smName)

    const graphDiv = (() => {
        // Creates new graph elements
        function newGraph() {
            const div = document.createElement("div")
            div.setAttribute("id", smName)
            div.setAttribute("class", "graph-container")

            const canvas = document.createElement("canvas")
            canvas.setAttribute("class", "graph-canvas")
            div.appendChild(canvas)

            return div
        }

        // Find existing, or create new in sorted order
        const graphsContainer = document.getElementById("graphs")
        for (const child of graphsContainer.children) {
            // Found existing
            if (child.id == smName) return child
            // New goes here
            if (child.id > smName) {
                const graphDiv = newGraph()
                child.before(graphDiv)
                return graphDiv
            }
        }
        // New goes at end
        const graphDiv = newGraph()
        graphsContainer.appendChild(graphDiv)
        return graphDiv
    })()

    const graphCanvas = graphDiv.children[0]

    const mDef = metricDefs[metricName]
    const better = mDef.higherIsBetter === null ? "" :
                   mDef.higherIsBetter          ? "Higher is better" :
                                                  "Lower is better"

    const chart = new Chart(graphCanvas, {
        type: "line",
        data: {
            datasets: []
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            parsing: {
                xAxisKey: "date",
                yAxisKey: "value"
            },
            scales: {
                xDefault: {
                    axis: "x",
                    display: "auto",
                    type: "time",
                    adapters: {
                        date: {
                            setZone: true,
                            zone: "UTC"
                        },
                    },
                    time: {
                        unit: "day",
                        tooltipFormat: "yyyy LLL dd",
                        displayFormats: {
                            day: 'yyyy LLL dd',
                        }
                    },
                    title: {
                        display: true,
                        text: "Date",
                        font: {
                            size: 16,
                            weight: "bold"
                        }
                    },
                    ticks: {
                        minRotation: 45,
                        maxRotation: 45
                    }
                },
                yDefault: {
                    axis: "y",
                    display: "auto",
                    title: {
                        display: true,
                        text: `${mDef.header} [${mDef.unit}]`,
                        font: {
                            size: 16,
                            weight: "bold"
                        }
                    }
                },
                yNorm: {
                    axis: "y",
                    display: "auto",
                    suggestedMin: 0.8,
                    suggestedMax: 1.2,
                    title: {
                        display: true,
                        text: `Normalized ${mDef.header} [-]`,
                        font: {
                            size: 16,
                            weight: "bold"
                        }
                    }
                },
                yLog: {
                    axis: "y",
                    display: "auto",
                    title: {
                        display: true,
                        text: `${mDef.header} [log10(${mDef.unit})]`,
                        font: {
                            size: 16,
                            weight: "bold"
                        }
                    }
                },
                yLogNorm: {
                    axis: "y",
                    display: "auto",
                    suggestedMin: -0.1,
                    suggestedMax:  0.1,
                    title: {
                        display: true,
                        text: `Normalized ${mDef.header} [log10(-)]`,
                        font: {
                            size: 16,
                            weight: "bold"
                        }
                    }
                },
            },
            plugins: {
                title: {
                    display: true,
                    align: "start",
                    text: ` ${smName} ${better ? " - " + better : ""}`,
                    font: {
                        size: 16,
                        weight: "bold"
                    }
                },
                tooltip: {
                    callbacks: {
                        footer: () => {
                            return "EEEE!!!"
                        },
                    }
                }

            }
        }
    })

    charts.set(smName, chart)
    return chart
}

const graphsAlt = document.getElementById("graphs-alt")

const dateLo = document.getElementById("date-lo")
const dateHi = document.getElementById("date-hi")

dateLo.max = new Date(Date.now() + 2*DAY_MS).toISOString().split("T")[0];
dateHi.max = dateLo.max
dateLo.onchange = updateCharts
dateHi.onchange = updateCharts



function updateCharts() {
    // If not yet loaded
    if (runInfos == null) return

    // Hide all charts
    function displayHeaderOnly(text) {
        for (const chart of charts.values()) {
            chart.canvas.parentNode.style.display = "none"
        }
        graphsAlt.textContent = text
        graphsAlt.style.display = "block"
    }

    // Check current selection
    const selectedCases = caseSelector.selected()
    if (selectedCases.size == 0) {
        displayHeaderOnly("Please select some Cases")
        return
    }
    const selectedRuns = runSelector.selected()
    if (selectedRuns.size == 0) {
        displayHeaderOnly("Please select some Runs")
        return
    }
    const selectedSM = smSelector.selected()
    if (selectedSM.size == 0) {
        displayHeaderOnly("Please select some Steps / Metrics")
        return
    }

    // Will display something, so hide header
    graphsAlt.style.display = "none"

    // Hide unselected charts
    for (const chartName of charts.keys()) {
        if (!selectedSM.has(chartName)) {
            charts.get(chartName).canvas.parentNode.style.display = "none"
        }
    }

    const dateL = dateLo.valueAsDate
    const dateH = new Date(dateHi.valueAsNumber + DAY_MS) // The next day, exclusive upper bound

    const selectedOptions = optionSelector.selected()
    const logarithmic = selectedOptions.has("Logarithmic")
    const mean = selectedOptions.has("Mean")
    const normalize = selectedOptions.has("Normalize")

    const yAxisID = (normalize && logarithmic) ? "yLogNorm" :
                    normalize                  ? "yNorm" :
                    logarithmic                ? "yLog" :
                                                 "yDefault"

    for (const smName of selectedSM) {
        const [stepName, metricName] = smName.split(" / ")

        const chart = getChart(stepName, metricName)
        chart.canvas.parentNode.style.display = "block"

        const datasets = []
        for (const caseName of selectedCases) {
            const caseData = allData.get(caseName)
            for (const runName of selectedRuns) {
                if (!(runName in caseData)) continue
                const runData = caseData[runName]
                if (!(stepName in runData)) continue
                const stepData = runData[stepName]
                if (!(metricName in stepData)) continue
                const metricData = stepData[metricName]
                if (metricData.length == 0) continue

                const data = []
                for (const entry of metricData) {
                    const date = runInfos[entry.run].date
                    if (date < dateL || dateH <= date) continue
                    const value = entry.values[0]
                    data.push({
                        date: date,
                        value: value,
                        raw: value,
                        run: entry.run
                    })
                }


                const label = `${caseName} ${runName}`
                const color = getStableColor(label)
                datasets.push({
                    label: label,
                    data: data,
                    xAxisID: "xDefault",
                    yAxisID: yAxisID,
                    borderColor: color,
                    backgroundColor: color
                })
            }
        }

        if (normalize) {
            for (const dataset of datasets) {
                let firstValue = null
                for (const data of dataset.data) {
                    if (firstValue == null) firstValue = data.value
                    data.value /= firstValue
                }
            }
        }

        if (mean) {
            const dateToVals = new Map()
            for (const dataset of datasets) {
                for (const data of dataset.data) {
                    const dateString = data.date.toISOString().split("T")[0]
                    if (!dateToVals.has(dateString)) dateToVals.set(dateString, [])
                    dateToVals.get(dateString).push(data.value)
                }
            }
            const dateStrings = Array.from(dateToVals.keys())
            dateStrings.sort()

            const sum = (a, b) => a+b
            const prod = (a, b) => a*b
            const reduction = normalize ? prod : sum

            const data = []
            for (const dateString of dateStrings) {
                const values = dateToVals.get(dateString)
                const n = values.length
                const reduced = values.reduce(reduction)
                const mean = normalize ? (reduced ** (1 / n)) : (reduced / n)
                data.push({
                    date: new Date(dateString),
                    value: mean
                })
            }

            datasets.splice(0, datasets.length) // Clear array
            datasets.push({
                label: normalize ? "Geometric mean of normalized values"
                                 : "Artithmetic Mean of values",
                data: data,
                xAxisID: "xDefault",
                yAxisID: yAxisID,
                borderColor: PALETTE[0],
                backgroundColor: PALETTE[0]
            })
        }

        if (logarithmic) {
            for (const dataset of datasets) {
                for (const data of dataset.data) {
                    data.value = Math.log10(data.value)
                }
            }
        }

        chart.data.datasets = datasets

        // Display if non-empty
        if (datasets.length > 0) {
            chart.canvas.parentNode.style.display = "block"
            chart.update()
        } else {
            chart.canvas.parentNode.style.display = "none"
        }
    }
}

function updateDateRange() {
    const dateRange = dateSelector.selected().values().next().value
    switch (dateRange) {
      case "Past 14 Days": {
        const hi = new Date()
        const lo = new Date(hi - 13*DAY_MS) // 13 days, as bounds in the UI are inclusive
        dateLo.valueAsDate = lo
        dateHi.valueAsDate = hi
        dateLo.disabled = true
        dateHi.disabled = true
        break;
      }
      case "All": {
        const hi = new Date()
        const lo = new Date(dateLo.getAttribute("min"))
        dateLo.valueAsDate = lo
        dateHi.valueAsDate = hi
        dateLo.disabled = true
        dateHi.disabled = true
        break;
      }
      case "Custom": {
        dateLo.disabled = false
        dateHi.disabled = false
        break;
      }
      default:
        console.error(`Unknown date range '${dateRange}'`);
    }

    updateCharts()
}

function saveState() {
    const state = {
        version: 1,
        dateLo: dateLo.value,
        dateHi: dateHi.value,
        optionSelection: Array.from(optionSelector.selected().values()).toSorted(),
        caseSelection: Array.from(caseSelector.selected().values()).toSorted(),
        runSelection: Array.from(runSelector.selected().values()).toSorted(),
        smSelection: Array.from(smSelector.selected().values()).toSorted()
    }
    return state
}

function loadState(state) {
    if (state.version != 1) {
        console.error(`Cannot handle state version '${state.version}'`)
        return
    }
    dateLo.value = state.dateLo
    dateHi.value = state.dateHi
    dateSelector.select("Custom")
    optionSelector.selectNone()
    optionSelector.selectMultiple(state.optionSelection)
    caseSelector.selectNone()
    caseSelector.selectMultiple(state.caseSelection)
    runSelector.selectNone()
    runSelector.selectMultiple(state.runSelection)
    smSelector.selectNone()
    smSelector.selectMultiple(state.smSelection)
}

const shareButton = document.getElementById("share-button")
shareButton.title = "Copy URL to clipboard to share this view"
shareButton.onclick = () => {
    const state = saveState()
    const stateString = lzstring.compressToBase64(JSON.stringify(state))
    const url = window.location.origin + window.location.pathname + "#" + stateString
    copyToClipboard(url)
}


async function entryPoint() {
    /* global VERSION */
    document.title += ` - ${VERSION}`

    // Add date ranges
    dateSelector.addToggle("Past 14 Days", false)
    dateSelector.addToggle("All", false)
    dateSelector.addToggle("Custom", false)

    // Add options
    optionSelector.addToggle("Normalize", false,
                             "Display relative values, normalized to the " +
                             " oldest value. This makes the first displayed " +
                             " data point 1.0 by definition, and other " +
                             " points are the ratio (value / oldest value).")
    optionSelector.addToggle("Mean", false,
                             "Display a single graph of daily averages " +
                             " computed across all selected graphs. " +
                             " (Uses the geometric mean if Normalzie is " +
                             " selected, otherwise uses the arithmetic mean.)")
    optionSelector.addToggle("Logarithmic", false,
                             "Display log10 of values on Y axis")

    // Fetch the actual data in the background, display progress modal
    let progressNow = 0
    const progressMax = cases.length + 3
    const modal = document.getElementById("progress-modal")
    modal.style.display = "block"
    function addProgress() {
        progressNow += 1
        const progress = Math.trunc(100 * progressNow / progressMax)
        const bar = document.getElementById("progress-bar")
        bar.style.width = `${progress}%`
    }

    const fetchJSON = (path) =>
        window
            .fetch(path)
            .then((response) => {
                // Parse as JSON
                const data = response.json()
                // Udpate progress bar
                addProgress()
                // Yield the data
                return data
            })

    // Fetch stepDefs
    const stepDefsPromise = fetchJSON("data/steps.json")
    // Fetch metricsDefs
    const metricsDefsPromise = fetchJSON("data/metrics.json")

    // Fetch actual results
    const dataPromises = Object.fromEntries(cases.map((caseName) => [
        caseName,
        window
            .fetch(`data/results/${caseName}.json`)
            .then((response) => {
                // Parse as JSON
                const data = response.json()
                // Add a selector for case when loaded
                caseSelector.addToggle(caseName, true)
                // Udpate progress bar
                addProgress()
                // Yield the data
                return data
            })
    ]))

    // Fetch runInfo
    const runInfoPromise =
        window
            .fetch("data/runinfo.json")
            .then((response) => {
                // Parse as JSON
                return response.json()
            })
            .then((data) => {
                // Parse dates
                for (const entry of data) {
                    entry.date = new Date(entry.date.split("T")[0] + "Z")
                }
                // Udpate progress bar
                addProgress()
                // Yield the data
                return data
            })


    // Wait for all data to arrive
    stepDefs = await stepDefsPromise
    metricDefs = await metricsDefsPromise
    for (const caseName in dataPromises) {
        allData.set(caseName, await dataPromises[caseName])
        // Depends on 'allData', so call it here manually
        updateRunSelector()
    }

    // Load state from URL fragment if present
    if (window.location.hash != "") {
        const base64state = window.location.hash.slice(1)
        const state = JSON.parse(lzstring.decompressFromBase64(base64state))
        loadState(state)
        // Clear URL fragment identifier to keep it neat
        window.location.hash = ""
    }

    // Wait for final fetch of runInfos
    runInfos = await runInfoPromise
    updateCharts()

    // Hide progress modal
    modal.style.display = "none"
}

entryPoint()
