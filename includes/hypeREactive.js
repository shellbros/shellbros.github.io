/** It's a Hyper Element! */

export class HyperElement {
	constructor () {
		this.parent = null
		this.children = []
		this.storeObject = null
		this.bindings = null
		this.propertiesToBind = []

		// First argument

		let tag = arguments[0].match(/^\w+/)
		tag = tag ? tag[0] : 'div'

		let id = arguments[0].match(/#[\w-]+/g)
		let displayBool = arguments[0].match(/\?[.\w-]+/g)
		let nonReactiveClasses = arguments[0].match(/\.[\w-]+/g)
		let allClasses = arguments[0].match(/\.[\w-{}]+/g)

		this.dom = document.createElement(tag)
		domMap.set(this.dom, this)

		if (id) {
			if (id.length > 1) {
				console.error('HyperElement descriptor contains more than one #id')
			}
			this.dom.id = id[0].substring(1)
		}

		if (displayBool) {
			if (displayBool.length > 1) {
				console.error('HyperElement descriptor contains more than one ?display boolean')
			}
			let val = displayBool[0].substring(1)
			this.setPropertiesToBind(val, this, 'isDisplayed')
		}

		if (nonReactiveClasses) {
			this.dom.className = nonReactiveClasses.map(v => v.substring(1)).join(' ')
		}

		if (allClasses) {
			let val = allClasses.map(v => v.substring(1)).join(' ')
			this.setPropertiesToBind(val, this.dom, 'className')
		}

		// Miscellaneous arguments before child elements, if any

		let i = 1, content = null

		// Set store object, if provided

		while (arguments[i] && !(arguments[i] instanceof HyperElement)) {
			let arg = arguments[i]

			if (arg[isProxy]) {
				this.storeObject = storeMap.get(arg)
				this.bindings = bindingsMap.get(arg)
			}
			else if (arg.constructor.name === 'String') {
				content = arg
			}
			else if (arg.constructor.name === 'Number') {
				content = String(arg)
			}
			else if (arg.constructor.name === 'Function') {
				// Wait... I don't remember why I have this here
				this.method = arg
				arguments.push(this.method())
			}
			else if (arg.constructor.name === 'Object') {
				// Set properties of either DOM or HyperElement
				Object.keys(arg).forEach(k => {
					if (k.startsWith('on')) {
						let fn = arg[k]
						this.dom.addEventListener(k.slice(2), e => fn(e, domMap.get(e.target)))
					}
					else {
						switch (k) {
							case 'style':
								let style = arg.style

								if (typeof style === 'string') {
									this.dom.style = style
									this.setPropertiesToBind(style, this.dom, 'style')
								}
								else {
									Object.keys(style).forEach(styleKey => {
										let val = style[styleKey]
										styleKey = unskewer(styleKey)
										this.dom.style[styleKey] = val
										this.setPropertiesToBind(val, this.dom.style, styleKey)
									})
								}
								break

							default:
								// Set DOM element property directly
								let val = arg[k]
								k = unskewer(k)
								this.dom[k] = val
								this.setPropertiesToBind(val, this.dom, k)
						}
					}
				})
			}
			i++
		}

		this.dom.innerHTML = content

		if (arguments[i] && arguments[i] instanceof Array) {
			arguments.push(...arguments[i])
			i++
		}

		// Add child HyperElements, if any

		setTimeout(() => {
			while (arguments[i]) {
				if (arguments[i] instanceof HyperElement) {
					this.append(arguments[i])
				}
				else {
					console.log(arguments[i])
				}
				i++
			}
		}, 0)

		if (content) {
			// The following block is here to support HTML in reactive values.
			// We may not want this, and may rather want to make it an option
			// on a per-HyperElement basis. Just leaving it here for now.

			/*this.setPropertiesToBind(this.dom.innerHTML, this.dom, 'innerHTML')
			for (let e of this.dom.children) {
				this.setPropertiesToBind(e.innerHTML, e, 'innerHTML')
			}*/

			// In the event that we DON'T want to allow HTML in reactive values,
			// or want to make it optional, this is how we would handle that:

			for (let n of this.dom.childNodes) {
				this.setPropertiesToBind(n.textContent, n, 'textContent')
			}
		}
	}

	setPropertiesToBind (content, target, targetKey) {
		this.propertiesToBind.push({ content, target, targetKey })
	}

	bindAllProperties () {
		if (!this.storeObject && this.parent && this.parent.storeObject) {
			this.storeObject = this.parent.storeObject
			this.bindings = this.parent.bindings
		}

		for (let p of this.propertiesToBind) {
			this.bindProperties(p.content, p.target, p.targetKey)
		}
	}
 
	bindProperties (content, target, targetKey) {
		if (!isNaN(content)) return

		if (target === this) {
			let binding = {
				hyperElement: this,
				key: content,
				target: target,
				targetKey: targetKey,
				isBound: false
			}

			queueReaction(this, binding)

			return
		}

		let props = content.match(/{{.*?}}/g)

		if (props) {
			if (!this.storeObject) {
				//throw new Error('HyperElement cannot find a Store to bind properties to. Please create one with h.store() and provide the result in h.mount(), this HyperElement, or a parent.')
			}

			for (let p of props) {
				let key = p.slice(2, -2).trim()
				let iterable = false

				if (key.startsWith('...')) {
					key = key.slice(3)
					iterable = true
					this.dom.innerHTML = '' // Iterable takes place of all other content
				}

				// Add binding

				let binding = {
					hyperElement: this,
					key: key,
					iterable: iterable,
					target: target,
					targetKey: targetKey,
					original: content,
					isBound: false
				}
				queueReaction(this, binding)
			}
		}
	}

	followKey (fullKey) {
		let keys = fullKey.split('.')
		let dom = this.bindings
		let k

		while ((k = keys.shift()) && keys.length > 0) {
			if (!dom[k]) dom[k] = {}
			dom = dom[k]
		}

		return [dom, k]
	}

	/** For internal use only. Don't call me! */

	getReactiveValue (key, binding) {
		let keys = key.split('.')

		if (!this.storeObject) {
			let he = this
			while (he = he.parent) {
				if (he.storeObject) {
					this.storeObject = he.storeObject
					this.bindings = he.bindings
					break
				}
			}
		}

		let val = this.storeObject

		if (!binding.isBound && key === binding.key) {
			const [dom, k] = this.followKey(key)
			if (!dom) {
				throw new Error('dom is undefined')
			}
			dom[k] = dom[k] || []
			dom[k].push(binding)
			binding.isBound = true			
		}

		for (let k of keys) {
			if (val[k] !== undefined) {
				val = val[k]
			}
			else {
				break
			}
		}

		return val
	}

	react (binding) {
		if (binding.target === this) {
			let key = binding.key
			binding.target[binding.targetKey] = this.getReactiveValue(key, binding)
			return
		}

		let props = binding.original.match(/{{.*?}}/g)
		let content = binding.original

		for (let p of props) {
			let key = p.slice(2, -2).trim()

			if (key.startsWith('...')) {
				// Property is an array

				key = key.slice(3)

				let val = this.getReactiveValue(key, binding)

				if (val) {
					this.removeChildren()

					if (val.length > 0) {
						for (let v of val) {
							if (v instanceof HyperElement) {
								this.append(v)
							}
							else {
								this.append(new HyperElement('', v))
							}
						}
					}
				}
			}
			else {
				// Property is a single value
				let val = this.getReactiveValue(key, binding)
				if (val === this.storeObject) val = p

				content = content.replace(p, val)

				binding.target[binding.targetKey] = content
			}
		}
	}

	removeChildren () {
		for (let c of this.children) {
			c.remove()
		}

		this.dom.innerHTML = ''
	}

	append () {
		for (let hyperElement of arguments) {	
			if (hyperElement.parent) {
				hyperElement.parent.children.splice(hyperElement.parent.children.indexOf(hyperElement), 1)
			}

			hyperElement.parent = this
			this.children.push(hyperElement)
			hyperElement.bindAllProperties()
			this.dom.appendChild(hyperElement.dom)
		}
	}

	insertBefore (hyperElement) {
		if (this.parent) {
			this.parent.children.splice(this.parent.children.indexOf(this), 1)
		}

		this.parent = hyperElement.parent

		let idx = hyperElement.parent.children.indexOf(hyperElement)
		hyperElement.parent.children.splice(idx, 0, this)
	
		this.bindAllProperties()
		hyperElement.parent.dom.insertBefore(this.dom, hyperElement.dom)
	}

	insertAfter (hyperElement) {
		if (this.parent) {
			this.parent.children.splice(this.parent.children.indexOf(this), 1)
		}

		this.parent = hyperElement.parent

		let idx = hyperElement.parent.children.indexOf(hyperElement)
		hyperElement.parent.children.splice(idx + 1, 0, this)

		this.bindAllProperties()
		hyperElement.parent.dom.insertBefore(this.dom, hyperElement.dom.nextSibling)
	}

	remove () {
		if (this.parent) {
			let i = this.parent.children.indexOf(this)
			if (i > -1) {
				this.parent.children.splice(i, 1)
			}
		}

		if (this.bindings && this.bindings instanceof Array) { // TODO: Shouldn't need Array exception?
			for (let b of this.bindings) {
				const [dom, k] = this.followKey(b.key)

				let db = dom[k]
				let i = db.indexOf(b)

				if (i > -1) {
					db.splice(i, 1)
					if (db.length === 0) {
						delete dom[k]
						// TODO: Go through parent bindings in store to see if they're empty, and delete them if so?
					}
				}
			}
		}

		this.dom.remove()
	}

	get isDisplayed () {
		return this.dom.style.display !== 'none'
	}

	set isDisplayed (val) {
		let s = this.dom.style
		s.display = val ? '' : 'none'
	}

	get siblings () {
		return this.parent.children.filter(e => e !== this )
	}

	getParent (selector) {
		let p = this.parent

		while (p) {
			if (p instanceof(selector)) return p
			p = p.parent
		}

		return null
	}
}

const queuedReactions = []
let flushRequestId

function queueReaction (he, binding) {
	queuedReactions.push({ he, binding })

	if (!flushRequestId) {
		flushRequestId = setTimeout(flushReactionQueue, 0)
	}
}

function flushReactionQueue () {
	flushRequestId = null
	let r
	while (r = queuedReactions.shift()) {
		r.he.react(r.binding)
	}
}

function unskewer (key) {
	return key.replace(/-./g, x => x[1].toUpperCase())
}

const isProxy = Symbol('isProxy')

function handler (localBindings) {
	return {
		get (obj, prop) {
			if (prop === isProxy) return true
			return obj[prop]
		},
		set (obj, prop, value) {
			// Goodness, this 'if' statement is gross, but it's the only way I've been able to get
			// both array assignment and array element assignment to be reactive at the same time.
			// I'm sure there's a better flow, but my brain is tired now.

			if (
				(value instanceof Object && !(value instanceof HyperElement) && !(value instanceof Array))
				|| (value instanceof Array && !(obj[prop] instanceof Array))
			) {
				if (!localBindings[prop]) {
					localBindings[prop] = []
				}
				obj[prop] = new Proxy(value, handler(localBindings[prop]))

				return true
			}

			obj[prop] = value

			let bindings
			bindings = localBindings[prop]

			if (!bindings) {
				bindings = localBindings
			}

			if (bindings && bindings instanceof Array) {
				for (let binding of bindings) {
					let h = binding.hyperElement
					queueReaction(h, binding)
				}
			}

			return true
		}
	}
}

/**
 * Returns a new HyperElement
 * @param {string} descriptor - HTML tag and/or class names.
 *		This may begin with the desired HTML tag, followed by an optional id preceded
 *		by a hashtag, and any number of class names, each preceded by a period.
 *		Separating each by a whitespace is supported, but not required. The tag name
 *		is optional. If omitted, "div" is assumed.
 * @param {Proxy} store - The Store object to use for this element and its children. Result of calling h.store().
 * @param {string|number} content - Text content of the element. May also contain HTML.
 * @param {Object} properties - Properties of DOM element.
 * @param {...HyperElement|HyperElement[]} children - List of child HyperElements.
 */

export function h () {
	let el = new HyperElement(...arguments)
	return el
}

/**
 * Just a wrapper for requestIdleCallback, because who can remember that crap?
 * @param {Function} fn - Function to call when the browser is idle.
 */

h.nextTick = function (fn) {
	requestIdleCallback(fn)
}

const storeMap = new WeakMap()		// Maps stores to their original objects
const bindingsMap = new WeakMap()	// Maps stores to bindings
const domMap = new WeakMap()		// Maps DOM elements to HyperElements

/**
 * Creates a new, reactive object store
 * @param {Object} object - Optional object to initialize the store.
 */
h.store = function (obj) {
	let store = obj || {}
	let bindings = {}
	let proxy = new Proxy(store, handler(bindings))

	storeMap.set(proxy, store)
	bindingsMap.set(proxy, bindings)

	return proxy
}

h.mount = function () {
	let i = 0
	let root = arguments[i]
	if (root instanceof HyperElement) {
		root = root.dom
	}
	root.innerHTML = ''

	let storeObject, domBindings

	if (arguments[++i][isProxy]) {
		storeObject = storeMap.get(arguments[i])
		domBindings = bindingsMap.get(arguments[i])
		i++
	}

	while(arguments[i]) {
		let he = arguments[i]
		if (!he.storeObject) {
			he.storeObject = storeObject
			he.bindings = domBindings
		}
		he.bindAllProperties()
		root.appendChild(he.dom)
		i++
	}
}