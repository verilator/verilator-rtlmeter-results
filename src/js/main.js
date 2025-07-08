import Chart from "chart.js/auto"
import "chartjs-adapter-luxon"
import copyToClipboard from "copy-to-clipboard"
import lzstring from "lz-string"
import { DateTime } from "luxon"
import { createTwoFilesPatch } from "diff"
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui-base.js'
import 'diff2html/bundles/css/diff2html.min.css'

import cases from "../data/cases.json"

const DAY_MS = 864e5  // 1 day in milliseconds


const PALETTE = [
    // Dark,    Light
    //          '#f3f3f3 + (0.2 alpha blended Dark)'
    ['#4c72b0', '#d2d9e6'],
    ['#dd8452', '#efddd3'],
    ['#55a868', '#d3e4d7'],
    ['#c44e52', '#ead2d3'],
    ['#8172b3', '#dcd9e6'],
    ['#937860', '#e0dad6'],
    ['#da8bc3', '#eedee9'],
    ['#8c8c8c', '#dedede'],
    ['#ccb974', '#ebe7da'],
    ['#64b5cd', '#d6e7eb']
]
const colorCache = new Map()
function getStableColorIndex(key) {
    if (!colorCache.has(key)) {
        colorCache.set(key, colorCache.size % PALETTE.length)
    }
    return colorCache.get(key)
}


const allData = new Map()
let stepDefs = null
let metricDefs = null
let runInfos = null

const cpuinfoCache = new Map()

async function getCPUInfo(hash) {
    if (!cpuinfoCache.has(hash)) {
        const value = await window
            .fetch(`data/cpuinfo/${hash}`)
            .then((response) => response.text())
        cpuinfoCache.set(hash, value)
    }
    return cpuinfoCache.get(hash)
}


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

let selA = {caseName: null, runName: null, execId: null}
let selB = {caseName: null, runName: null, execId: null}

function pointRadius(context, /* options */) {
    if (context.type == "data") {
        const chart = context.chart
        const dataset = chart.data.datasets[context.datasetIndex]
        const data = dataset.data[context.index]
        if (selB.execId === data.execId && selB.execId !== null
            && selB.caseName === dataset.caseName && selB.caseName !== null
            && selB.runName === dataset.runName && selB.runName !== null) {
                return 10
        }
        if (selA.execId === data.execId && selA.execId !== null
            && selA.caseName === dataset.caseName && selA.caseName !== null
            && selA.runName === dataset.runName && selA.runName !== null) {
                return 10
        }
    }
    return 3
}

function pointStyle(context, /* options */) {
    if (context.type == "data") {
        const chart = context.chart
        const dataset = chart.data.datasets[context.datasetIndex]
        const data = dataset.data[context.index]
        if (selB.execId === data.execId && selB.execId !== null
            && selB.caseName === dataset.caseName && selB.caseName !== null
            && selB.runName === dataset.runName && selB.runName !== null) {
                return "rect"
        }
        if (selA.execId === data.execId && selA.execId !== null
            && selA.caseName === dataset.caseName && selA.caseName !== null
            && selA.runName === dataset.runName && selA.runName !== null) {
                return "triangle"
        }
    }
    return "circle"
}


let pendingHover = null
function onLegendHover(evt, item, legend) {
    clearTimeout(pendingHover)
    pendingHover = setTimeout(() => {
        legend.chart.data.datasets.forEach((dataset, index) => {
            dataset.borderColor = PALETTE[dataset.colorIndex][0]
            dataset.backgroundColor = PALETTE[dataset.colorIndex][0]
            dataset.order = 0
            if (item.datasetIndex !== index) {
                dataset.borderColor = PALETTE[dataset.colorIndex][1]
                dataset.backgroundColor = PALETTE[dataset.colorIndex][1]
                dataset.order = 1
            }
        })
        legend.chart.update()
    }, 150)
}
function onLegendLeave(evt, item, legend) {
    clearTimeout(pendingHover)
    pendingHover = setTimeout(() => {
        legend.chart.data.datasets.forEach((dataset) => {
            dataset.borderColor = PALETTE[dataset.colorIndex][0]
            dataset.backgroundColor = PALETTE[dataset.colorIndex][0]
            dataset.order = 0
        })
        legend.chart.update()
    }, 150)
}
function onHoverHandler(chart, args) {
    // Ignore mouse move outside chart area, onLegend* handles these
    if (args.event.type == "mousemove" && !args.inChartArea) return
    clearTimeout(pendingHover)
    pendingHover = setTimeout(() => {
        chart.data.datasets.forEach((dataset) => {
            dataset.backgroundColor = PALETTE[dataset.colorIndex][0]
            dataset.borderColor = PALETTE[dataset.colorIndex][0]
            dataset.order = 0
        });

        const item = chart.getElementsAtEventForMode(args.event, "nearest",
                                                     { intersect: true }, false)[0];
        if (item !== undefined) {
            chart.data.datasets.forEach((dataset, i) => {
                if (item.datasetIndex != i) {
                    dataset.backgroundColor = PALETTE[dataset.colorIndex][1]
                    dataset.borderColor = PALETTE[dataset.colorIndex][1]
                    dataset.order = 1
                }
            })
        }

        chart.update();
    }, 150)
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
            interaction: {
                mode: "nearest",
                intersect: false
            },
            elements: {
                point: {
                    radius: pointRadius,
                    hoverRadius: pointRadius,
                    pointHitRadius: 6,
                    pointStyle: pointStyle
                }
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
                legend: {
                    onHover: onLegendHover,
                    onLeave: onLegendLeave,
                    labels: {
                        padding: 6,
                        sort: (a, b) => a.text.localeCompare(b.text)
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
        updateDetails()
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
                    const execId = entry.run
                    const date = runInfos[execId].date
                    if (date < dateL || dateH <= date) continue
                    const value = entry.values[0]
                    data.push({
                        date: date,
                        value: value,
                        raw: value,
                        execId: execId
                    })
                }


                const label = `${caseName} | ${runName}`
                const colorIndex = getStableColorIndex(label)
                datasets.push({
                    caseName: caseName,
                    runName: runName,
                    label: label,
                    data: data,
                    xAxisID: "xDefault",
                    yAxisID: yAxisID,
                    colorIndex: colorIndex,
                    borderColor: PALETTE[colorIndex][0],
                    backgroundColor: PALETTE[colorIndex][0],
                    order: 0
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

            const colorIndex = 0
            datasets.splice(0, datasets.length) // Clear array
            datasets.push({
                label: normalize ? "Geometric mean of normalized values"
                                 : "Artithmetic Mean of values",
                data: data,
                xAxisID: "xDefault",
                yAxisID: yAxisID,
                colorIndex: colorIndex,
                borderColor: PALETTE[colorIndex][0],
                backgroundColor: PALETTE[colorIndex][0]
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

    // Update details panel
    updateDetails()
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
      case "Past 2 Days": {
        const hi = new Date()
        const lo = new Date(hi - 1*DAY_MS) // 1 day, as bounds in the UI are inclusive
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
        version: 2,
        dateLo: dateLo.value,
        dateHi: dateHi.value,
        optionSelection: Array.from(optionSelector.selected().values()).toSorted(),
        caseSelection: Array.from(caseSelector.selected().values()).toSorted(),
        runSelection: Array.from(runSelector.selected().values()).toSorted(),
        smSelection: Array.from(smSelector.selected().values()).toSorted(),
        detailsA: selA,
        detailsB: selB
    }
    return state
}

function loadState(state) {
    if (state.version > 2) {
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
    if (state.version >= 2) {
        selA = state.detailsA
        selB = state.detailsB
    }
}

const shareButton = document.getElementById("share-button")
shareButton.title = "Copy URL to clipboard to share this view"
shareButton.onclick = () => {
    const state = saveState()
    const stateString = lzstring.compressToBase64(JSON.stringify(state))
    const url = window.location.origin + window.location.pathname + "#" + stateString
    copyToClipboard(url)
}

const modal = document.getElementById("modal")

function showModal(id, autoClose) {
    let root = null
    for (const node of modal.children) {
        if (node.id == id) {
            node.style.display = "flex"
            root = node
        } else {
            node.style.display = "none"
        }
    }

    // If not closed automatically, allow closing by either:
    // - Clicking on the overlay outside the modal itself
    // - Clicking the close button, if there is one exists
    if (!autoClose) {
        modal.onclick = (event) => {
            if (event.target === modal) hideModal()
        }
        const button = root.querySelector(".modal-close-button")
        if (button) button.onclick = hideModal
    }
    modal.style.display = "flex"
}

function hideModal() {
    modal.style.display = "none"
    modal.onclick = null
}

const detailsA = {
    name: document.getElementById("details-a").querySelector("#case-name"),
    info: document.getElementById("details-a").querySelector("#info"),
    data: document.getElementById("details-a").querySelector("#metrics")
}
const detailsB = {
    name: document.getElementById("details-b").querySelector("#case-name"),
    info: document.getElementById("details-b").querySelector("#info"),
    data: document.getElementById("details-b").querySelector("#metrics")
}
const detailsDiff = {
    name: document.getElementById("details-diff").querySelector("#case-name"),
    info: document.getElementById("details-diff").querySelector("#info"),
    data: document.getElementById("details-diff").querySelector("#metrics")
}

function getFormattedDate(execId) {
    return DateTime.fromJSDate(runInfos[execId].date).toFormat("yyyy-MM-dd")
}

function getVerilatorCommit(execId) {
    return runInfos[execId]["VerilatorVersion"].split("-g")[1].slice(0, 8)
}

function getRTLMeterCommit(execId) {
    return runInfos[execId]["RTLMeterVersion"].slice(0, 8)
}

function getCPUInfoHash(execId) {
    return runInfos[execId]["cpuinfo"]
}

function addTableRow(table, columns) {
    const row = document.createElement("tr")
    for (const col of columns) {
        const cell = document.createElement("td")
        if (typeof(col) == "string") {
            cell.textContent = col
        } else {
            cell.appendChild(col)
        }
        row.appendChild(cell)
    }
    table.appendChild(row)
}

function addDetails(panel, sel, data) {
    // Set case name
    panel.name.textContent = sel.caseName

    // Update info table
    {
        panel.info.replaceChildren()
        // Add date
        addTableRow(panel.info, ["Date:", getFormattedDate(sel.execId)])
        // Add run name
        addTableRow(panel.info, ["Run:", sel.runName])
        // Add link to Verilator commit
        {
            const commit = getVerilatorCommit(sel.execId)
            const a = document.createElement("a")
            a.setAttribute("class", "details-clickable")
            a.setAttribute("href", `https://github.com/verilator/verilator/commits/${commit}`)
            a.setAttribute("target", "_blank")
            a.textContent = commit
            addTableRow(panel.info, ["Verilator:", a])
        }
        // Add link to RTLMeter commit
        {
            const commit = getRTLMeterCommit(sel.execId)
            const a = document.createElement("a")
            a.setAttribute("class", "details-clickable")
            a.setAttribute("href", `https://github.com/verilator/rtlmeter/commits/${commit}`)
            a.setAttribute("target", "_blank")
            a.textContent = commit
            addTableRow(panel.info, ["RTLMeter:", a])
        }
        // Add host CPU info
        {
            const hash = getCPUInfoHash(sel.execId)
            const b = document.createElement("button")
            b.setAttribute("class", "details-clickable")
            b.textContent = hash
            b.onclick = async () => {
                const title = document.getElementById("cpuinfo-title")
                const body = document.getElementById("cpuinfo")
                const date = getFormattedDate(sel.execId)
                title.textContent = `CPU info for:   ${sel.caseName} | ${sel.runName} @ ${date}`
                body.textContent = await getCPUInfo(hash)
                showModal("cpuinfo-modal", /* autoClose: */ false)
            }
            addTableRow(panel.info, ["Host CPU:", b])
        }
        panel.info.style.display = "block"
    }

    // Update data table
    {
        panel.data.replaceChildren()
        // Add metrics
        for (const smName of data.keys()) {
            const metricName = smName.split(" / ").at(-1)
            const mDef = metricDefs[metricName]
            addTableRow(panel.data, [smName, `${data.get(smName).toFixed(2)} ${mDef.unit}`])
        }
        panel.data.style.display = "block"
    }
}

function getDetails(sel) {
    const {caseName, runName, execId} = sel
    if (caseName === null || runName === null || execId === null) return null

    if (!caseSelector.selected().has(caseName)) return null
    if (!runSelector.selected().has(runName)) return null

    const date = runInfos[execId].date
    const dateL = dateLo.valueAsDate
    if (date < dateL) return null
    const dateH = new Date(dateHi.valueAsNumber + DAY_MS) // The next day, exclusive upper bound
    if (dateH < date) return null

    if (!allData.has(caseName)) return null
    const caseData = allData.get(caseName)
    if (!(runName in caseData)) return null
    const runData = caseData[runName]

    const result = new Map()
    for (const smName of smSelector.selected()) {
        const [stepName, metricName] = smName.split(" / ")

        if (!(stepName in runData)) continue
        const stepData = runData[stepName]
        if (!(metricName in stepData)) continue
        const metricData = stepData[metricName]

        for (const entry of metricData) {
            if (entry.run == execId) {
                result.set(smName, entry.values[0])
                break
            }
        }
    }
    return result
}

function updateDetails() {
    // Options
    const mean = optionSelector.selected().has("Mean")

    // Update details panel A
    detailsA.info.style.display = "none"
    detailsA.data.style.display = "none"
    let dataA = null
    if (mean) {
        detailsA.name.textContent = "Not available with option 'Mean' enabled"
    } else {
        dataA = getDetails(selA)
        if (dataA === null) {
            detailsA.name.textContent = "Click chart to select ▲ data point"
        } else {
            addDetails(detailsA, selA, dataA)
        }
    }

    // Update details panel B
    detailsB.info.style.display = "none"
    detailsB.data.style.display = "none"
    let dataB = null
    if (mean) {
        detailsB.name.textContent = "Not available with option 'Mean' enabled"
    } else {
        dataB = getDetails(selB)
        if (dataB === null) {
            detailsB.name.textContent = "Double click chart to select ■ data point"
        } else {
            addDetails(detailsB, selB, dataB)
        }
    }

    // Update details diff panel
    detailsDiff.info.style.display = "none"
    detailsDiff.data.style.display = "none"
    if (mean) {
        detailsDiff.name.textContent = "Not available with option 'Mean' enabled"
    } else if (dataA === null) {
        detailsDiff.name.textContent = "Click chart to select ▲ data point"
    } else if (dataB === null) {
        detailsDiff.name.textContent = "Double click chart to select ■ data point"
    } else {
        // Add case name
        if (selA.caseName == selB.caseName){
            detailsDiff.name.textContent = selA.caseName
        } else {
            detailsDiff.name.innerHTML = `${selA.caseName}<br>→<br>${selB.caseName}`
        }

        // Update info table
        {
            detailsDiff.info.replaceChildren()
            // Add date
            {
                const dateA = getFormattedDate(selA.execId)
                const dateB = getFormattedDate(selB.execId)
                let text = null
                if (dateA == dateB) {
                    text = `${dateA} (same)`
                } else {
                    text = `${dateA} → ${dateB}`
                }
                if (dateA > dateB) {
                    text += " (reverse)"
                }
                addTableRow(detailsDiff.info, ["Date:", text])
            }
            // Add run name
            {
                let text = null
                if (selA.runName == selB.runName) {
                    text = `${selA.runName} (same)`
                } else {
                    text = `${selA.runName} → ${selB.runName}`
                }
                addTableRow(detailsDiff.info, ["Run:", text])
            }
            // Add link to Verilator diff
            {
                const commitA = getVerilatorCommit(selA.execId)
                const commitB = getVerilatorCommit(selB.execId)
                const span = document.createElement("span")
                const link = document.createElement("a")
                const post = document.createElement("span")
                if (commitA == commitB) {
                    link.textContent = `${commitA}`
                    link.setAttribute("href", `https://github.com/verilator/verilator/commits/${commitA}`)
                    post.textContent = " (same)"
                } else if (runInfos[selA.execId].date < runInfos[selB.execId].date) {
                    link.textContent = `${commitA}...${commitB}`
                    link.setAttribute("href", `https://github.com/verilator/verilator/compare/${commitA}...${commitB}`)
                } else {
                    link.textContent = `${commitA}...${commitB}`
                    link.setAttribute("href", `https://github.com/verilator/verilator/compare/${commitB}...${commitA}`)
                    post.textContent = " (reverse)"
                }
                link.setAttribute("class", "details-clickable")
                link.setAttribute("target", "_blank")
                span.appendChild(link)
                span.appendChild(post)
                addTableRow(detailsDiff.info, ["Verilator:", span])

            }
            // Add link to RTLMeter diff
            {
                const commitA = getRTLMeterCommit(selA.execId)
                const commitB = getRTLMeterCommit(selB.execId)
                const span = document.createElement("span")
                const link = document.createElement("a")
                const post = document.createElement("span")
                if (commitA == commitB) {
                    link.textContent = `${commitA}`
                    link.setAttribute("href", `https://github.com/verilator/rtlmeter/commits/${commitA}`)
                    post.textContent = " (same)"
                } else if (runInfos[selA.execId].date < runInfos[selB.execId].date) {
                    link.textContent = `${commitA}...${commitB}`
                    link.setAttribute("href", `https://github.com/verilator/rtlmeter/compare/${commitA}...${commitB}`)
                } else {
                    link.textContent = `${commitA}...${commitB}`
                    link.setAttribute("href", `https://github.com/verilator/rtlmeter/compare/${commitB}...${commitA}`)
                    post.textContent = " (reverse)"
                }
                link.setAttribute("class", "details-clickable")
                link.setAttribute("target", "_blank")
                span.appendChild(link)
                span.appendChild(post)
                addTableRow(detailsDiff.info, ["RTLMeter:", span])
            }
            // Add host CPU info diff
            {
                const hashA = getCPUInfoHash(selA.execId)
                const hashB = getCPUInfoHash(selB.execId)
                const span = document.createElement("span")
                const butn = document.createElement("button")
                const post = document.createElement("span")
                const dateA = getFormattedDate(selA.execId)
                const dateB = getFormattedDate(selB.execId)
                const titleA = `${selA.caseName} | ${selA.runName} @ ${dateA}`
                const titleB = `${selB.caseName} | ${selB.runName} @ ${dateB}`
                if (hashA == hashB) {
                    butn.textContent = `${hashA}`
                    butn.onclick = async() => {
                        const title = document.getElementById("cpuinfo-title")
                        const body = document.getElementById("cpuinfo")
                        title.innerHTML = `CPU info for:   ${titleA}   AND   ${titleB}`
                        body.textContent = await getCPUInfo(hashA)
                        showModal("cpuinfo-modal", /* autoClose: */ false)
                    }
                    post.textContent = " (same)"
                } else {
                    butn.textContent = `${hashA} != ${hashB}`
                    butn.onclick = async() => {
                        const cpuinfoPromiseA = getCPUInfo(hashA)
                        const cpuinfoPromiseB = getCPUInfo(hashB)
                        const cpuinfoA = await cpuinfoPromiseA
                        const cpuinfoB = await cpuinfoPromiseB

                        // Set title
                        const title = document.getElementById("cpuinfo-diff-title")
                        title.textContent = `CPU info diff:   ${titleA}   →   ${titleB}`
                        // Compute patch
                        const patch = createTwoFilesPatch(titleA, titleB, cpuinfoA, cpuinfoB)
                        // Display via 'diff2html'
                        const body = document.getElementById("cpuinfo-diff")
                        const conf = { drawFileList: false, matching: "words", highlight: false }
                        const diff2HtmlUI = new Diff2HtmlUI(body, patch, conf)
                        diff2HtmlUI.draw()
                        // Show the diff modal
                        showModal("cpuinfo-diff-modal", /* autoClose: */ false)
                    }
                }
                butn.setAttribute("class", "details-clickable")
                span.appendChild(butn)
                span.appendChild(post)
                addTableRow(detailsDiff.info, ["Host CPU:", span])
            }
            detailsDiff.info.style.display = "block"
        }

        // Update data table
        {
            detailsDiff.data.replaceChildren()
            // Add metrics
            for (const smName of dataA.keys()) {
                const valA = dataA.get(smName)
                const valB = dataB.get(smName)
                if (valB === undefined) continue
                addTableRow(detailsDiff.data, [smName, `${(valB/valA).toFixed(3)}x`])
            }
            detailsDiff.data.style.display = "block"
        }
    }
}

let pendingClick = null
function onClickHandler(chart, args) {
    // Ignore if 'Mean' option is clicked
    if (optionSelector.selected().has("Mean")) return
    // Figure out what was clicked and record selection
    const interactionOptions = chart.options.interaction
    const interactionMode = interactionOptions.mode
    const item = chart.getElementsAtEventForMode(args.event, interactionMode, interactionOptions, false)[0];
    if (item === undefined) return
    const dataset = chart.data.datasets[item.datasetIndex]
    const caseName = dataset.caseName
    const runName = dataset.runName
    const execId = dataset.data[item.index].execId
    if (args.event.native.detail == 1) {
        clearTimeout(pendingClick)
        pendingClick = setTimeout(() => {
            selA = {caseName, runName, execId}
            for (const chart of charts.values()) {
                chart.update()
            }
            updateDetails()
        }, 300)
    } else {
        clearTimeout(pendingClick)
        pendingClick = setTimeout(() => {
            selB = {caseName, runName, execId}
            for (const chart of charts.values()) {
                chart.update()
            }
            updateDetails()
        }, 0)
    }
}

const selectorPlugin = {
    id: "selector",
    afterEvent(chart, args) {
        if (args.replay) return
        if (args.event.type == "click" ) {
            onClickHandler(chart, args)
        } else if (args.event.type == "mousemove" || args.event.type == "mouseout") {
            onHoverHandler(chart, args)
        }
    }
}


Chart.register(selectorPlugin)


async function entryPoint() {
    /* global VERSION */
    document.title += ` - ${VERSION}`

    // Add date ranges
    dateSelector.addToggle("Past 14 Days", false)
    dateSelector.addToggle("Past 2 Days", false)
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
    showModal("progress-modal", /* autoClose: */ true)
    let progressNow = 0
    const progressMax = cases.length + 3
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
                // Parse dates, set hour/minute/second to 0, timezone to UTC
                for (const entry of data) {
                    entry.date = new Date(entry.date.split("T")[0] + "T00:00:00Z")
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
    hideModal()
}

entryPoint()
