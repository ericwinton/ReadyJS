var ReadyJS = function(options) {
	this.cssPreprocessor = 'none';
	this.routes = [];
	this.data = {};
	this.functions = {};
	this.components = {};
	this.routeData = [];
	this.root = document.getElementById('root');
	
	for (var key in options) {
		this[key] = options[key];
	}
	
	this.newRoute = (url, method = 'push') => {
		if (this.beforeRouteChange) {
			this.beforeRouteChange();
		}
		
		// change history state
		if (url === window.location.pathname || method === 'replace') {
			history.replaceState(null, null, url);
		} else if (method === 'push') {
			history.pushState({prevUrl: this.url?.fullPath || window.location.pathname}, null, url);
		}
		
		// clear all
		this.cStore = [];
		this.completedFirstRenders = [];
		this.styles = [];
		this.callbacks = {};
		this.url = {};
	
		// process url and get route
		processUrl();
		getRoute();
		
		if (this.afterRouteChange) {
			this.afterRouteChange();
		}
		
		getRouteData(() => {
			if (this.routeDataReady) {
				this.routeDataReady();
			}
			
			this.render('root', {}, this.root);
		});
	};
	
	var processUrl = () => {
		var urlFull = encodeURI(window.location.href);
        var urlPath = encodeURI(window.location.pathname);
        var urlHash = encodeURI(window.location.hash);
        var urlQueryString = encodeURI(window.location.search);
        var urlQueryParams = {};
        var previousUrl = '';
    
        if (urlQueryString) {
            var urlQueryStringArray = urlQueryString.replace(/\?/g, "").split("&");
        
            urlQueryStringArray.forEach(function(param) {
                var paramParts = param.split("=");
                urlQueryParams[paramParts[0]] = decodeURIComponent(paramParts[1].replace(/\+/g, ' '));
            });
        }
    
        if (window.history.state && window.history.state.prevUrl) {
            previousUrl = window.history.state.prevUrl;
        }
    
        this.url = {
            full: urlFull,
            protocol: encodeURI(window.location.protocol),
            hostname: encodeURI(window.location.hostname),
            path: urlPath,
            fullPath: encodeURI(urlPath + urlQueryString + urlHash),
            pathArray: urlPath.replace(/^\/|\/$/g, "").split("/"),
            queryString: urlQueryString,
            params: urlQueryParams,
			mapped: {},
            hash: urlHash.replace(/#/, ""),
            previous: previousUrl
        };
    };
	
	var getRoute = () => {
		for (var i = 0; i < this.routes.length; i++) {
			var route = this.routes[i];
			var routePaths = route.paths;

			for (var j = 0; j < routePaths.length; j++) {
				var realPathMatches = 0;
				var mappedPathMatches = 0;
				var routePath = routePaths[j];
				var routePathArray = routePath.substring(1, routePath.length).split('/');

				if (routePathArray.length === this.url.pathArray.length) {
					for (var k = 0; k < routePathArray.length; k++) {
						if (routePathArray[k] === this.url.pathArray[k]) {
							realPathMatches++;
						}

						if (routePathArray[k].indexOf(':') > -1) {
							var mappedKey = routePathArray[k].split(':')[1];
							var mappedValue = this.url.pathArray[k];
							mappedPathMatches++;
							this.url.mapped[mappedKey] = mappedValue;
						}
					}

					if ((realPathMatches + mappedPathMatches) === routePathArray.length) {
						this.route = route;
						return;
					}
				}
			}
		}
    };
	
	var getRouteData = async (callback) => {		
		if (!this.models || (!this.route.data && app.routeData.length === 0)) { callback(); return; }
		
		var routeDataToLoad = this.route.data || [];
		var allDataToLoad = [...app.routeData, ...routeDataToLoad];

		for (var i = 0; i < allDataToLoad.length; i++) {
			var dataKey = allDataToLoad[i];
			
			if (!this.models[dataKey]) { console.warn('ReadyJS Error: Data Model Key "' + dataKey + '" Not Found'); callback(); return; }
			
			if (this.models[dataKey].get) {
				this.data[dataKey] = await this.models[dataKey].get();
			}
		}
		
		callback();
	};
	
	var renderStyles = () => {
		if (document.getElementById('rjs-styles')) {
			var styleEl = document.getElementById('rjs-styles');
			styleEl.innerHTML = app.styles.join('');
			if (typeof less !== 'undefined') { styleEl.type = 'text/less'; less.refresh(); }
		} else {
			var styleEl = document.createElement('style');
			styleEl.id = 'rjs-styles';
			if (typeof less !== 'undefined') { styleEl.type = 'text/less'; }
			styleEl.innerHTML = app.styles.join('');
			document.head.append(styleEl);
			if (typeof less !== 'undefined') { less.refresh(); }
		}
	}
	
	var renderComplete = async (targetCId) => {
		var target = document.querySelector('[data-component-id="' + targetCId + '"]');
		
		renderStyles();

		for (var i = 0; i < this.cStore.length; i++) {
			var cStoreItem = this.cStore[i];
			var cStoreItemId = cStoreItem.id;
			var cTarget = document.querySelector('[data-component-id="' + cStoreItemId + '"]');
			
			if (cTarget) {
				if (cStoreItem.onFirstRender && this.completedFirstRenders.indexOf(cStoreItemId) === -1) {
					this.completedFirstRenders.push(cStoreItemId);
					await cStoreItem.onFirstRender(cTarget);
				}

				if (cStoreItem.onEveryRender) {
					await cStoreItem.onEveryRender(cTarget);
				}
			} else {
				this.cStore.splice(i, 1);
				i--;
			}
		}
	};
	
	this.run = (e, fnName, fnSource) => {
		var cId = (fnSource) ? null : +e.target.closest('[data-component-id]').dataset.componentId;

		for (var i = 0; i < this.cStore.length; i++) {
			var cStoreItem = this.cStore[i];

			if ((fnSource && cStoreItem.name === fnSource) || (cId && cStoreItem.id === cId)) {
				if (!cStoreItem.functions || !cStoreItem.functions[fnName]) {
					e.preventDefault();
					console.error('ReadyJS Error: Unknown function "' + fnName + '" in "' + cStoreItem.name + '" component');
					break;
				}
				
				cStoreItem.functions[fnName](e);
				
				break;
			}
		}
	};
	
	var updateEl = (el, templateDom, domAction) => {
		if (domAction === 'append') {
			el.append(templateDom);
		} else if (domAction === 'prepend') {
			el.prepend(templateDom);
		} else if (domAction === 'appendChildren') {
			var children = [...templateDom.children];

			for (var i = 0; i < children.length; i++) {
				el.append(children[i]);
			}
		} else if (domAction === 'prependChildren') {
			var children = [...templateDom.children];

			for (var i = children.length; i >= 0; i--) {
				el.prepend(children[i]);
			}
		} else {
			if (el.id === 'root') {
				var newDom = document.createElement('div');
				newDom.id = 'root';
				newDom.append(templateDom);
				compareNodes(el, newDom);
			} else {
				compareNodes(el, templateDom);
			}
		}
	};
	
	this.render = (componentName, props = {}, target = null, domAction = 'replace') => {
		var cName = (componentName === 'route') ? this.route.component : componentName;
		console.log('rendering: ', cName, props, target);
		
		var c = this.components[cName](props);
		var cId = (target && target.getAttribute('data-component-id')) ? +target.getAttribute('data-component-id') : Math.floor((Math.random() * 999999) + 1000000);
		
		if (c.styles) {
			var stylesClean = c.styles.replace(/\t/g, '').replace(/\n/g, '').replace(/  /g, '');
			
			if (this.styles.indexOf(stylesClean) === -1) {
				this.styles.push(stylesClean);
			}
		}
		
		if (c.template) {
			var templateBody = new DOMParser().parseFromString(c.template.replace(/\t/g, '').replace(/\n/g, ''), 'text/html').body;

			if (templateBody.children.length > 1) { console.error('ReadyJS Error: The "' + cName + '" component template has more than one root element'); return; }

			var templateDom = templateBody.children[0];

			if (templateDom) {
				templateDom.setAttribute('data-component-id', cId);
				
				var cStoreMatch = false;
				var cStoreObj = {
					id: cId,
					name: cName,
					props: props,
					watch: c.watch,
					functions: c.functions,
					onFirstRender: c.onFirstRender,
					onEveryRender: c.onEveryRender,
					el: templateDom
				};
				
				for (var i = 0; i < this.cStore.length; i++) {
					var cStoreItem = this.cStore[i];
					
					if (cStoreItem.id === cId) {
						this.cStore[i] = cStoreObj;
						cStoreMatch = true;
						break;
					}
				}
												   
				if (!cStoreMatch) {
					this.cStore.push(cStoreObj);
				}

				if (target) {					
					if (target instanceof NodeList) {
						target.forEach((el) => {
							updateEl(el, templateDom, domAction);
						});
					} else {
						updateEl(target, templateDom, domAction);
					}

					renderComplete(cId);
				} else {
					return templateBody.innerHTML;
				}
			}
		} else {
			return '';
		}
	};
	
	// single data key update
	this.update = async (dataKey, dataValue, updateDom = true) => {
		app.data[dataKey] = dataValue;

		if (this.models && this.models[dataKey] && this.models[dataKey].set) {		
			await this.models[dataKey].set(dataValue);
		}
		
		if (updateDom) {
			for (var i = 0; i < this.cStore.length; i++) {
				var cStoreItem = this.cStore[i];
				
				if (cStoreItem.watch && cStoreItem.watch.indexOf(dataKey) > -1) {
					this.render(cStoreItem.name, cStoreItem.props, document.querySelector(`[data-component-id="${cStoreItem.id}"]`));
				}
			}
		}
	};
	
	var compareAttributes = (domNode, vdomNode) => {
        if (!domNode.attributes || !vdomNode.attributes) { return false }
		
		var domNodeClone = domNode.cloneNode(true);
		var vdomNodeClone = vdomNode.cloneNode(true);
		
		domNodeClone.removeAttribute('data-component-id');
		vdomNodeClone.removeAttribute('data-component-id');
		
        if (domNodeClone.attributes.length !== vdomNodeClone.attributes.length) { return false }
		
		for (var i = 0; i < domNodeClone.attributes.length; i++) {
			if (domNodeClone.attributes[i] && vdomNodeClone.attributes[i] 
				&& domNodeClone.attributes[i].value !== vdomNodeClone.attributes[i].value) { return false; }
		}
		
		if (domNode.getAttribute('data-component-id')) {
			domNode.setAttribute('data-component-id', vdomNode.getAttribute('data-component-id'));
		}

        return true;
    };

    var compareNodes = (domNode, vdomNode) => {
        if (!domNode || !vdomNode) { return; }
        var childDomNodes = Array.prototype.slice.call(domNode.childNodes);
        var childVdomNodes = Array.prototype.slice.call(vdomNode.childNodes);

        if (domNode.nodeType === vdomNode.nodeType) {
            if (domNode.nodeType === 3) {
                if (domNode.textContent.trim() !== vdomNode.textContent.trim()) {
                    domNode.textContent = vdomNode.textContent;
                }
            } else {
                if (domNode.tagName === vdomNode.tagName && compareAttributes(domNode, vdomNode)) {
                    if (childDomNodes.length >= childVdomNodes.length) {
                        childDomNodes.forEach((childDomNode, i) => {
                            if (childVdomNodes[i]) {
                                compareNodes(childDomNode, childVdomNodes[i]);
                            } else {
                                childDomNode.remove();
                            }
                        });
                    } else {
                        childVdomNodes.forEach((childVdomNode, i) => {
                            if (childDomNodes[i]) {
                                compareNodes(childDomNodes[i], childVdomNode);
                            } else {
                                domNode.appendChild(childVdomNode);
                            }
                        });
                    }
                } else {
                    domNode.replaceWith(vdomNode);
                }
            }
        } else {
            domNode.replaceWith(vdomNode);
        }
    };
	
	window.onpopstate = () => {
		this.newRoute(window.location.href, 'pop');
	};
	
	window.onload = () => {
		document.addEventListener('click', (e) => {
			if (e.target.closest('a')) {
				var href = e.target.closest('a').getAttribute('href');
				
				if (href.indexOf('#') !== 0) {
					e.preventDefault();
					this.newRoute(href);
				}
			}
		});
		
		if (this.cssPreprocessor === 'less') {
			var lessScript = document.createElement('script');
			lessScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/less.js/4.1.2/less.min.js';
			lessScript.onload = () => {				
				this.newRoute(window.location.href);
			};
			document.body.append(lessScript);
		} else {
			this.newRoute(window.location.href);
		}
	};
};