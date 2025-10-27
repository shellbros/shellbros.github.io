import { TinyTSDBclient, Aggregator, Scale } from './tinyTSDBclient.js'
import { h, HyperElement } from './includes/hypeREactive.js'

function setupChart (data, title) {
	var series = []

	for (let d of data) {
		series.push({
			name: d.label,
			data: d.data.map(d => { return [d.t, d.v] })
		})
	}

	var timeFormat

	if (data[0]) {
		switch (data[0].interval) {
			case Scale.Second:
				timeFormat = 'HH:mm:ss'
				break
			case Scale.Minute:
				timeFormat = 'HH:mm:ss'
				break
			case Scale.Hour:
				timeFormat = 'MMM dd, yyyy HH:mm'
				break
			case Scale.Day:
				timeFormat = 'MMM dd, yyyy'
				break
			case Scale.Week:
				timeFormat = 'MMM dd, yyyy'
				break
			case Scale.Month:
				timeFormat = 'MMM yyyy'
				break
			case Scale.Year:
				timeFormat = 'yyyy'
				break
			default:
				timeFormat = 'MMM dd, yyyy HH:mm:ss'
				break
		}
	}

	let options = {
		series,
		colors: ['#5af', '#5f5', '#ff5', '#fa5', '#f55', '#a5f', '#aaf'],
		theme: {
			mode: 'dark'
		},
		stroke: {
			width: 3,
			curve: 'straight'
		},
		chart: {
			type: 'line',
			background: 'transparent',
			stacked: false,
			height: 400,
			zoom: {
				type: 'x',
				enabled: true,
				autoScaleYaxis: true
			},
			events: {
				beforeZoom: (chartContext, { xaxis }) => {
					start = Math.floor(xaxis.min)
					end = Math.floor(xaxis.max)

					if (end < chartContext.maxX) {
						live = false
					}

					requestIdleCallback(() => updateCharts())
				},
				zoomed: (chartContext, { xaxis, yaxis }) => {
				}
			},
			toolbar: {
				show: false
			},
			animations: {
				speed: 300,
				animateGradually: {
					enabled: true,
					delay: 20
				},
				dynamicAnimation: {
					speed: 200
				}
			}
		},
		dataLabels: {
			enabled: false
		},
		markers: {
			size: 0,
		},
		title: {
			text: title,
			align: 'left',
			style: {
				fontSize: '18px',
				color: '#aaa'
			}
		},
		grid: {
			borderColor: 'rgba(255, 255, 255, 0.15)',
			yaxis: {
				lines: {
					show: true
				}
			},
			xaxis: {
				lines: {
					show: true
				}
			}
		},
		yaxis: {
			labels: {
				formatter: function (val) {
					return Math.floor(val).toLocaleString('en-US')
				},
				style: {
					fontSize: '14px',
					colors: '#777'
				}
			},
			forceNiceScale: true,
			min: 0,
		},
		xaxis: {
			type: 'datetime',
			min: start,
			max: end,
			tooltip: {
				enabled: false
			},
			labels: {
				style: {
					fontSize: '14px',
					colors: '#777'
				},
				format: timeFormat,
				datetimeUTC: false
			}
		},
		legend: {
			position: 'top',
			fontSize: '14px',
			labels: {
				colors: '#aaa'
			}
		},
		tooltip: {
			fixed: {
				enabled: false
			},
			shared: true,
			x: {
				show: true,
				format: timeFormat,
				formatter: undefined
			},
			style: {
				fontSize: '14px'
			}
		}
	}

	return options
}

function createChart (element, data, title) {
	let options = setupChart(data, title)

	var chart = new ApexCharts(element, options)
	chart.render()

	return chart
}

// Get and display

let tsdb = new TinyTSDBclient('wss://' + window.location.hostname + '/status/')

let now = Date.now()
let start = now - Scale.Hour
let end = now
let live = true

let store = h.store()

const dropdownItems = [
	{ label: '1 minute', scale: Scale.Minute },
	{ label: '1 hour', scale: Scale.Hour },
	{ label: '6 hours', scale: Scale.Hour * 6 },
	{ label: '12 hours', scale: Scale.Hour * 12 },
	{ label: '1 day', scale: Scale.Day },
	{ label: '1 week', scale: Scale.Week },
	{ label: '1 month', scale: Scale.Month },
	{ label: '1 year', scale: Scale.Year },
]

const scaleDropdown = new class Dropdown extends HyperElement {
	constructor () {
		let props = h.store()

		super('.dropdown', props, {
				tabIndex: -1,
				style: 'display: {{display}}; left: {{left}}px; top: {{top}}px;',
				onblur: () => {
					this.close()
				}
			},
			...dropdownItems.map(i => h('.dropdown-item', i.label, {
				onclick: () => {
					end = Date.now()
					start = end - i.scale
					live = true
					updateCharts()
					this.close()
				}
			}))
		)

		props.display = 'none'
		this.props = props
	}

	open (parent) {
		let rect = parent.dom.getBoundingClientRect()
		this.props.display = 'default'
		this.props.left = rect.left
		this.props.top = rect.bottom

		h.nextTick(() => this.dom.focus())
	}

	close () {
		this.props.display = 'none'
	}

	toggle (parent) {
		if (this.props.display === 'none') {
			this.open(parent)
		}
		else {
			this.close()
		}
	}
}

h.mount(document.body, store,
	h('.content',
		h('.row .mb-lg',
			h('.inline .center .column',
				h('.header .mb-sm', 'Players: {{players}}'),
				h('.header-sm', 'All-time high: <b class="light">{{playersMax}}</b> on {{playersMaxDate}}')
			),
			h('.inline .center .column',
				h('.header .mb-sm', 'Games: {{games}}'),
				h('.header-sm', 'All-time high: <b class="light">{{gamesMax}}</b> on {{gamesMaxDate}}')
			)
		),
		h('#chart1'),
		h('#chart2'),
		h('#chart3'),
		h('#chart4'),
		h('#chart5'),
		h('#chart6'),
		h('#chart7'),
	),
	h('.bar',
		h('.button .icon', '<', {
			onclick: () => {
				let diff = Math.floor((end - start) * 0.5)
				start -= diff
				end -= diff
				live = false

				updateCharts()
			}
		}),
		h('.button .icon', '-', {
			onclick: () => {
				let diff = end - start

				if (live) {
					end = Date.now()
					start = end - diff * 2
				}
				else {
					start -= diff
				}

				updateCharts()
			}
		}),
		h('.button .icon', '+', {
			onclick: () => {
				let diff = end - start

				if (live) {
					end = Date.now()
					start = end - diff * 0.5
				}
				else {
					start += Math.floor(diff * 0.5)
				}

				updateCharts()
			}
		}),
		h('.button .icon', '>', {
			onclick: () => {
				let diff = end - start
				end += Math.floor(diff * 0.5)

				if (end >= Date.now()) {
					live = true
					end = Math.min(end, Date.now())
				}

				start = end - diff

				updateCharts()
			}
		}),
		h('.button .icon', '>>', {
			onclick: () => {
				let diff = end - start
				end = Date.now()
				start = end - diff
				live = true

				updateCharts()
			}
		}),
		h('.barSplit'),
		h('.button', '{{scale}}', {
			onclick: (e, he) => {
				scaleDropdown.toggle(he)
			}
		}),
		scaleDropdown
	),
)

let charts = [
	{
		chart: null,
		element: '#chart1',
		key: ['players:*'],
		title: 'Total Number of Players',
		aggregator: Aggregator.Max,
		showMax: true
	},
	{
		chart: null,
		element: '#chart2',
		key: 'players:region:*',
		title: 'Number of Players per Region',
		aggregator: Aggregator.Max,
		showMax: true
	},
	{
		chart: null,
		element: '#chart3',
		key: ['games:*'],
		title: 'Total Number of Games',
		aggregator: Aggregator.Max,
		showMax: true
	},
	{
		chart: null,
		element: '#chart4',
		key: 'games:type:*',
		title: 'Number of Games by Type',
		aggregator: Aggregator.Max
	},
	{
		chart: null,
		element: '#chart5',
		key: 'games:public:type:*',
		title: 'Number of Public Games by Type',
		aggregator: Aggregator.Max
	},
	{
		chart: null,
		element: '#chart6',
		key: 'games:publicNoob:type:*',
		title: 'Number of Public Noob Games by Type',
		aggregator: Aggregator.Max
	},
	{
		chart: null,
		element: '#chart7',
		key: 'games:private:type:*',
		title: 'Number of Private Games by Type',
		aggregator: Aggregator.Max
	}
]

function updateCharts () {
	tsdb.getAllTime('players:total', Aggregator.Max)
	.then(data => {
		store.playersMax = data[0].v.toLocaleString('en-US')
		store.playersMaxDate = new Date(data[0].t).toLocaleString('en-UK')
	})
	.catch(err => console.error(err))

	tsdb.getAllTime('players:region:*', Aggregator.Max)
	.then(data => store.playersPerRegionMax = data)
	.catch(err => console.error(err))

	tsdb.getLatest('players:total', Aggregator.Max)
	.then(data => { store.players = data[0].v.toLocaleString('en-US') })
	.catch(err => console.error(err))

	tsdb.getAllTime('games:total', Aggregator.Max)
	.then(data => {
		store.gamesMax = data[0].v.toLocaleString('en-US')
		store.gamesMaxDate = new Date(data[0].t).toLocaleString('en-UK')
	})
	.catch(err => console.error(err))

	tsdb.getLatest('games:total', Aggregator.Max)
	.then(data => {
		store.games = data[0].v.toLocaleString('en-US')
		store.gamesDate = new Date(data[0].t).toLocaleString('en-UK')
	})
	.catch(err => console.error(err))

	for (let chart of charts) {
		tsdb.get(chart.key, start, end, chart.aggregator)
		.then(data => {
			if (chart.chart === null) {
				chart.chart = createChart(document.querySelector(chart.element), data, chart.title)
			}
			else {
				let options = setupChart(data, chart.title)
				chart.chart.updateOptions(options, false, false)
			}

			if (chart.showMax) {
				let maxVal = 0
				let maxTime = 0
				for (let d of data) {
					for (let o of d.data) {
						if (o.v > maxVal) {
							maxVal = o.v
							maxTime = o.t
						}
					}
				}
				chart.chart.addPointAnnotation({
					x: maxTime,
					y: maxVal,
					label: {
						style: {
							background: 'black',
							fontSize: '14px',
							color: 'var(--color-lightest)'
						},
						text: `Max: ${maxVal.toLocaleString('en-US')}`
					},
				}, false)
			}

			var span = end - start
			var scales = Object.keys(Scale)

			/*let resolution
			for (let i = 0; i < scales.length; i++) {
				let scale = Scale[scales[i]]
				if (data[0].interval < Scale[scales[i + 1]]) {
					resolution = `${Math.ceil(data[0].interval / scale)} ${scales[i]}`
					break
				}
			}*/

			let i
			for (i = 0; i < scales.length; i++) {
				let scale = Scale[scales[i]]
				if (span < scale * 2) {
					if (live) {
						store.scale = `Last ${Math.floor(span / Scale[scales[i - 1]])} ${scales[i - 1]}s`
					}
					else {
						store.scale = `${Math.floor(span / Scale[scales[i - 1]])} ${scales[i - 1]}s`
					}
					break
				}
			}

			if (i === scales.length) {
				store.scale = `Last ${Math.floor(span / Scale[scales[i - 1]])} ${scales[i - 1]}s`
			}
		})
		.catch(err => console.error(err))
	}
}

updateCharts()