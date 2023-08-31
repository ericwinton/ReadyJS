const ReadyJS = function(options) {
	const self = this;
	
	this.root = document.getElementById('root');
	this.cssPreprocessor = 'none';
	this.cssPrepend = '';
	this.data = {};
	this.routes = [];
	this.routeData = {};
	this.routeRenderCount = 1;
	this.stories = {};
	this.components = {};
	this.tests = {};
	this.showTests = false;
	this.debug = false;
	this.plugins = [];
	
	let activeElement;
	let stylesAdded = [];
	let stylesRendered = [];
	let lastNestedIndex = -1;
	let nestedRouteReturnIndex = -1;
	let startPageLoad = null;
	let componentKeys = ['template', 'styles', 'watch', 'onCreate', 'onRender', 'onDestroy', 'functions'];
	
	for (let key in options) {
		this[key] = options[key];
	}
	
	const appendStyles = (styles, name) => {
		const stylesClean = styles.trim().replace(/\n/g, '').replace(/\t/g, '');
		const ss = document.createElement('style');
		const cssPrepend = this.cssPrepend.trim().replace(/\n/g, '').replace(/\t/g, '');

		ss.id = name + '-styles';
		ss.innerText = cssPrepend + stylesClean;
		ss.type = (typeof less !== 'undefined') ? 'text/less' : 'text/css';
		document.head.append(ss);
		stylesRendered.push(name);
	};
	
	const removeStoreItems = (node) => {
		if (node.nodeType === 3) { return }
		
		const childIds = Array.from(node.querySelectorAll('[data-rjs-id]')).map(el => el.dataset.rjsId);
		const idsToRemove = (node.dataset.rjsId) ? [node.dataset.rjsId, ...childIds] : childIds;
		
		idsToRemove.forEach(id => {
			const storeItem = this.cStore[id];
			if (storeItem?.onDestroy) { storeItem.onDestroy(); }
			delete this.cStore[id];
		});
	};
	
	this.goto = async (url, method = 'push') => {
		if (this.debug) { startPageLoad = new Date().getTime(); }
		
		if (this.beforeRouteChange) {
			await this.beforeRouteChange();
		}
		
		// change history state
		if (url === window.location.pathname || method === 'replace') {
			history.replaceState(null, null, url);
		} else if (method === 'push') {
			history.pushState({prevUrl: this.url?.fullPath || window.location.pathname}, null, url);
		}
		
		// clear all
		this.cStore = {};
		this.onCreateCompleted = [];
		this.styles = [];
		this.url = {};
		this.route = null;
		this.nestedRoutes = [];
		
		nestedRouteReturnIndex = -1;
		lastNestedIndex = -1;
	
		processUrl();
		
		if (this.routes.length) {
			getRoute();
			
			if (!this.route) {
				this.nestedRoutes.push('rjs404');
				this.components.rjs404 = () => { return { template: `<p>404 - Page Not Found</p>` } };
			}
		}
		
		if (this.afterRouteChange) {
			await this.afterRouteChange();
		}
		
		await getRouteData();

		if (this.routeDataReady) {
			await this.routeDataReady();
		}
			
		window.scrollTo(0, 0);

		this.render('root');
	};
	
	const processUrl = () => {
		var urlFull = decodeURI(window.location.href);
        var urlPath = decodeURI(window.location.pathname);
        var urlHash = decodeURI(window.location.hash);
        var urlQueryString = decodeURI(window.location.search);
        var urlQueryParams = {};
        var previousUrl = '';
    
        if (urlQueryString) {
            var urlQueryStringArray = urlQueryString.replace(/\?/g, '').split('&');
        
            urlQueryStringArray.forEach(function(param) {
                var paramParts = param.split("=");
                urlQueryParams[decodeURIComponent(paramParts[0])] = decodeURIComponent(paramParts[1].replace(/\+/g, ' '));
            });
        }
    
        if (window.history.state && window.history.state.prevUrl) {
            previousUrl = window.history.state.prevUrl;
        }
    
        this.url = {
            full: urlFull,
            protocol: decodeURI(window.location.protocol),
            hostname: decodeURI(window.location.hostname),
            path: urlPath,
            fullPath: decodeURI(urlPath + urlQueryString + urlHash),
            pathArray: (urlPath === '/') ? [] : urlPath.replace(/^\/|\/$/g, '').split('/'),
            queryString: urlQueryString,
            params: urlQueryParams,
			mapped: {},
            hash: urlHash.replace(/#/, ''),
            previous: previousUrl
        };
    };
	
	const getRoute = () => {
		const fullRoutes = [];
		
		this.routes.forEach(mainRoute => {
			let routeArray = [];
			let routeComponents = [];

			function processRoute(route, childIndex) {
				if (route.path && route.path !== '/') {
					routeArray.push(route.path);
				}

				if (route.component) {
					routeComponents.push(route.component);
				}

				if (route.children) {
					const numChildren = route.children.length;

					route.children.forEach((childRoute, childIndex) => {
						processRoute(childRoute, childIndex);

						if (childIndex === (numChildren - 1)) {
							if (route.path) { routeArray.pop(); }
							if (route.component) { routeComponents.pop(); }
						}
					});
				} else {
					const routeUrl = (routeArray[0] === '') ? '/' : routeArray.join('');
					fullRoutes.push({url: routeUrl, components: [...routeComponents]});

					if (route.path) { routeArray.pop(); }
					if (route.component) { routeComponents.pop(); }
				}
			}

			processRoute(mainRoute, 0);
		});
		
		const matchedRoute = fullRoutes.find(route => {
			const routeArray = (route.url === '/') ? [] : route.url.split('/').slice(1);
			
			if (route.url === this.url.path) { return route; }
			
			if (route.url === '*') { return route; }

			if (routeArray.length !== this.url.pathArray.length) { return false; }

			const match = routeArray.every((routePathSegment, i) => {
				return routePathSegment === this.url.pathArray[i] || routePathSegment[0] === ':';
			});

			if (match) {
				routeArray.forEach((segment, i) => {
					if (segment[0] === ':') {
						const propName = segment.slice(1);
						this.url.mapped[propName] = decodeURIComponent(this.url.pathArray[i]);
					}
				});
			}

			return match;
		});
		
		if (matchedRoute) {
			this.nestedRoutes = matchedRoute.components;
			this.route = matchedRoute;
		}
	};

	const getRouteData = async () => {
		return new Promise(async (resolve, reject) => {
			for (var n = 0; n < this.nestedRoutes.length; n++) {
				var nestedRoute = this.nestedRoutes[n];

				if (this.routeData[nestedRoute]) {
					await this.routeData[nestedRoute]();
				}
			}

			resolve();
		});
	};
	
	this.update = (data) => {
		if (this.debug) { console.log('[ReadyJS Debug] Updating app data:', data); }
		
		const reRender = (dataKey) => {
			for (let cId in this.cStore) {
				const cStoreItem = this.cStore[cId];

				if (cStoreItem.watch && cStoreItem.watch.length && cStoreItem.watch.indexOf(dataKey) > -1) {
					app.render(cStoreItem.name, cStoreItem.props, cId);
				}
			}
		};
		
		if (typeof data == 'string') {
			reRender(data);
		} else {
			for (let dataKey in data) {
				this.data[dataKey] = data[dataKey];
				reRender(dataKey);
			}
		}
	};
	
	const setNewActive = () => {
		let activeNode = (activeElement?.id) ? document.getElementById(activeElement.id) : null;
		
		if (activeNode) {
			activeNode.focus();

			if (activeNode.value) {
				const prevVal = activeNode.value;
				activeNode.value = '';
				activeNode.value = prevVal;
			}
		}
	};
	
	const renderComplete = () => {
		this.styles.forEach(s => {
			if (stylesRendered.indexOf(s.name) === -1) {
				if (this.debug) { console.log('[ReadyJS Debug] Appending styles for "' + s.name + '"'); }
				appendStyles(s.styles, s.name);
			}
		});
		
		if (typeof less !== 'undefined') { less.refresh(); }
		
		for (let key in this.cStore) {
			const storeItem = this.cStore[key];
			const el = document.querySelector('[data-rjs-id="' + key + '"]');
			
			if (!el) { continue }
			
			if (storeItem.onCreate && !this.onCreateCompleted.includes(key)) {
				if (this.debug) { console.log('[ReadyJS Debug] Running onCreate for component "' + storeItem.name + '"'); }
				this.onCreateCompleted.push(key);
				storeItem.onCreate(el);
			}
			
			if (storeItem.onRender) {
				if (this.debug) { console.log('[ReadyJS Debug] Running onRender for component "' + storeItem.name + '"'); }
				storeItem.onRender(el);
			}
		}
		
		setNewActive();
		
		if (this.routeRenderCount === 1 && this.showTests) {
			this.test();
		}
	}
	
	this.run = (e, fnName) => {
		const findTarget = (target) => {
			const cId = target.dataset.rjsId;
			const cStore = this.cStore[cId];
			
			if (cStore && cStore.functions && cStore.functions[fnName]) {
				cStore.functions[fnName](e, cStore.props);
			} else {
				if (target.parentElement?.closest('[data-rjs-id]')) {
					findTarget(target.parentElement.closest('[data-rjs-id]'));
				} else {
					console.error('ReadyJS Error: Component not found for function "' + fnName + '"');
				}
			}
		};
		
		findTarget(e.target.closest('[data-rjs-id]'));
	};
	
	this.render = (componentName = null, props = {}, targetId = null, outputType = 'string') => {
		let cName = componentName;
		
		if (!componentName) { console.error('ReadyJS Error: Missing component name in render function'); return ''; }
		
		if (componentName === 'route') {
			if (!this.routes.length) { console.error('ReadyJS Error: No routes have been defined'); return ''; }

			lastNestedIndex++;
			
			cName = this.nestedRoutes[lastNestedIndex];
			
			if (!this.components[cName] && nestedRouteReturnIndex !== -1) {
				// reset to first component that contained an onCreate function
				lastNestedIndex = nestedRouteReturnIndex;
				cName = this.nestedRoutes[lastNestedIndex];
			}
			
			if (!this.components[cName]) { console.error('ReadyJS Error: Component not found for nested route "' + cName + '"'); return ''; }
		}
		
		if (!this.components[cName]) { console.error('ReadyJS Error: Component "' + cName  + '" not found'); return ''; }
		
		if (this.debug) {
			if (targetId) {
				if (this.debug) { console.log('[ReadyJS Debug] Re-rendering:', cName, props, targetId); }
			} else {
				if (this.debug) { console.log('[ReadyJS Debug] Rendering:', cName, props, targetId); }
			}
		}
		
		const cId = targetId || Math.floor(Math.random() * (999999 - 100000) + 999999);
		
		const proxyProps = new Proxy(props, {
			set(target, prop, value) {
				props[prop] = value;
				self.render(cName, props, cId);
			},
		});
		
		const c = this.components[cName](proxyProps);
		
		for (let cKey in c) {
			if (!componentKeys.includes(cKey)) { console.error('ReadyJS Error: Component "' + cName  + '" contains unknown property "' + cKey + '"'); }
		}
		
		if (c.styles && stylesAdded.indexOf(cName) === -1) {
			const stylesClean = c.styles.trim().replace(/\n/g, '').replace(/\t/g, '');
			this.styles.unshift({name: cName, styles: stylesClean});
			stylesAdded.push(cName);
		}
		
		this.cStore[cId] = {
			name: cName,
			watch: c.watch || null,
			props: props,
			functions: c.functions || null,
			onCreate: c.onCreate || null,
			onRender: c.onRender || null,
			onDestroy: c.onDestroy || null,
		};
		
		if (c.template) {
			const templateString = c.template.trim().replace(/\n/g, '').replace(/\t/g, '');
			const templateShell = (templateString.indexOf('<tr>') === 0 || templateString.indexOf('<tr ') === 0 || templateString.indexOf('<td>') === 0 || templateString.indexOf('<td ') === 0) ? document.createElement('table') : document.createElement('div');
			
			templateShell.innerHTML = templateString;
			
			if (!templateShell.children.length) { console.error('ReadyJS Error: No root node found in component "' + cName + '"'); }
			if (templateShell.children.length > 1) { console.error('ReadyJS Error: More than one root node found in component "' + cName + '"'); }
			
			const templateDom = templateShell.children[0];

			templateDom.setAttribute('data-rjs-id', cId);
		
			if (outputType === 'dom') {
				return templateDom;
			}
			
			if (targetId) {
				const target = document.querySelector('[data-rjs-id="' + targetId + '"]');
				activeElement = document.activeElement;
				this.compareNodes(target, templateDom);
				renderComplete(targetId);
			} else if (cName === 'root') {
				const newRoot = document.createElement('div');
				newRoot.id = this.root.id;
				newRoot.append(templateDom);
				this.compareNodes(this.root, newRoot);
				renderComplete();
				this.routeRenderCount++;
				document.activeElement.blur();
				if (this.debug) { console.log('[ReadyJS Debug] Page load: ' + ((new Date().getTime() - startPageLoad) / 1000).toFixed(3) + 's'); }
			} else {
				return templateDom.outerHTML;
			}
		} else if (targetId) {
			renderComplete(targetId);
			return '';
		} else {
			return '';
		}
	};
	
	this.renderDom = (componentName, props) => {
		return this.render(componentName, props, null, 'dom');
	},
	
	this.replaceAttributes = (oldNode, newNode) => {
		if (!oldNode.attributes || !newNode.attributes) { return }
		
		const oldNodeAttrs = oldNode.attributes;
		const newNodeAttrs = newNode.attributes;
		
		for (let i = 0; i < newNodeAttrs.length; i++) {
			const newNodeAttr = newNodeAttrs[i];
			const oldNodeAttr = oldNodeAttrs[newNodeAttr.name];

			if (!oldNodeAttr || oldNodeAttr.value !== newNodeAttr.value) {
				if (oldNodeAttr?.name === 'data-rjs-id') {
					removeStoreItems(oldNode);
				}
				
				oldNode.setAttribute(newNodeAttr.name, newNodeAttr.value);
			}
		}
		
		for (let i = 0; i < oldNodeAttrs.length; i++) {
			const oldNodeAttr = oldNodeAttrs[i];
			const newNodeAttr = newNodeAttrs[oldNodeAttr.name];

			if (!newNodeAttr) {
				oldNode.removeAttribute(oldNodeAttr.name);
			}
		}
	};
	
	this.compareNodes = (oldNode, newNode) => {
		if (!oldNode || !newNode) { return }
		
		const oldChildNodes = [...oldNode.childNodes];
		const newChildNodes = [...newNode.childNodes];
		
		// type mismatch, replace
		if (oldNode.nodeType !== newNode.nodeType || oldNode.tagName !== newNode.tagName) {
			removeStoreItems(oldNode);
			oldNode.replaceWith(newNode);
			return;
		}
		
		// text nodes
		if (oldNode.nodeType === 3 && oldNode.textContent !== newNode.textContent) {
			oldNode.textContent = newNode.textContent;
			return;
		}
		
		this.replaceAttributes(oldNode, newNode);
		
		// children		
		if (newChildNodes.length > oldChildNodes.length) {
			newChildNodes.forEach((newChildNode, i) => {				
				if (oldChildNodes[i]) {
					this.compareNodes(oldChildNodes[i], newChildNode);
				} else {
					oldNode.append(newChildNode);
				}
			});
		} else {
			oldChildNodes.forEach((oldChildNode, i) => {
				if (newChildNodes[i]) {
					this.compareNodes(oldChildNode, newChildNodes[i]);
				} else {
					removeStoreItems(oldChildNode);
					oldChildNode.remove();
				}
			});
		}
	};
	
	this.test = () => {
		let passingTests = 0;
		let failingTests = 0;

		const start = new Date().getTime();
		
		if (!this.tests) { console.log(`--- ReadyJS: No tests found ---`); return; }
		
		console.log('--- ReadyJS: Testing started ---');
		
		for (let cName in this.tests) {
			for (let testName in this.tests[cName]) {
				const result =  this.tests[cName][testName]();
				const passFail = (result) ? 'Passed' : 'Failed';
				const passFailColor = (result) ? 'green' : 'red';
				
				if (result) { passingTests++; } else { failingTests++; }
				
				console.log('%cReadyJS Test%c | %c' + passFail + '%c | %c' + cName + ' - ' + testName, 'color: darkorange', 'color: lightgray', 'color: ' + passFailColor, 'color: lightgray', 'color: black');
			}
		}
		
		const end = new Date().getTime() - start;
		const passingTestsText = (passingTests.length === 1) ? 'test' : 'tests';
		const failingTestsText = (failingTests.length === 1) ? 'test' : 'tests';
		
		console.log(`--- ReadyJS: Testing complete with ${passingTests} passing ${passingTestsText} and ${failingTests} failing ${failingTestsText} in ${(end / 1000).toFixed(3)}s ---`);
	}
	
	window.addEventListener('popstate', () => {
		app.goto(app.url.previous);
	});
	
	document.addEventListener('click', (e) => {
		if (e.target.closest('a')) {
			const href = e.target.closest('a').getAttribute('href');
			const exluded = ['#', 'http://', 'https://', '//', 'mailto:', 'tel:'];

			if (exluded.indexOf(href) !== 0) {
				e.preventDefault();
				this.goto(href);
			}
		}
	});

	if (this.cssPreprocessor === 'less') {
		less = (this.env === 'dev') ? { env: 'development' } : null;
		const script = document.createElement('script');
		script.src = 'https://cdnjs.cloudflare.com/ajax/libs/less.js/4.1.3/less.min.js';
		script.onload = () => {
			this.goto(window.location.href, 'replace');
		};
		document.body.append(script);
	} else {
		this.goto(window.location.href, 'replace');
	}
};
