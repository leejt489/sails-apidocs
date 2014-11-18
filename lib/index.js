String.prototype.capitalize = function() {
	return this.charAt(0).toUpperCase() + this.slice(1);
}

String.prototype.lowerFirst = function() {
	return this.charAt(0).toLowerCase() + this.slice(1);
}


var _config = require('./config'),
parse = require('./parser'),
dir = require('./dir'),

path = require('path'),
fs = require('fs'),
_ = require('lodash'),
doxx = require('doxx'),
async = require('async'),
pluralize = require('pluralize');

var _apidoc = {},
blueprintDocs,
_controllerDocs,
_modelDocs,
_routes;

/**
 * Generates docs for a sails api
 */
module.exports = function(config) {
	//Merge specified config options
	if (config) _config = _.extend(_config, config);

	//Load all the info from source files and configs
	_getBlueprintDocs();
	_getControllerDocs();
	_getModelDocs();
	_getRoutes();

	//Create the docs source
	var results = _mergeDocs();

	//Use doxx to compile
	doxx({
		target: _config.targetDir,
		source: results,
		template: _config.template
	});
}

/**
 * Using the blueprint config, controller configs, and the route config, determine all of the routes that will be exposed and their targets
 */
function _getRoutes() {
	//Require all of the controllers and models
	var controllers = _requireAll(_config.controllersDir);
	//var models = _requireAll(_config.modelsDir);

	//From the controllers, build a collection of resources
	var resourceNames = [];
	Object.keys(controllers).forEach(function(controller) {
		//Rename the key to the controller to be '[Resource]' instead of '[Resource]Controller'
		var t = controller.slice(0, -10); //minus 10 to strip out 'Controller' from the file name
		controllers[t] = controllers[controller];
		delete controllers[controller];

		//Add the resource
		resourceNames = resourceNames.concat(t);
	});

	var resourceRoutes = {}; //Initialize the collection of routes for the resource

	resourceNames.forEach(function(resourceName) {
		if (_config.exclude && _config.exclude.contains(resourceName)) return;
		
		var controller = controllers[resourceName];

		var controllerConfig = controller._config ? controller._config : {};

		//Load up the config params
		var rest = controllerConfig.rest ? controllerConfig.rest : _config.blueprints.rest;
		var actions = controllerConfig.actions ? controllerConfig.actions : _config.blueprints.actions;
		var prefix = controllerConfig.prefix ? controllerConfig.prefix : _config.blueprints.prefix;
		var plural = controllerConfig.pluralize ? controllerConfig.pluralize : _config.blueprints.pluralize;
		//TODO: handle shortcuts var shortcuts = controllerConfig.shortcuts ? controllerConfig.shortcuts : _config.blueprints.shortcuts;

		var resourceDocs = []; //Initialize the docs for this resource

		//Get the controller docs for this resource
		var controllerDocs = _controllerDocs[resourceName];

		var defaultPrefix = prefix + (plural ? pluralize(resourceName).lowerFirst() : resourceName.lowerFirst()) //TODO: pluralize

		resourceName = resourceName.lowerFirst(); //Use non-capitalized resource name

		if (rest) {
			//Load the REST routes
			resourceRoutes['get ' + defaultPrefix] = {model: resourceName, blueprint: 'find', resource: resourceName};
			resourceRoutes['get ' + defaultPrefix + '/:id'] = {model: resourceName, blueprint: 'findOne', resource: resourceName};
			resourceRoutes['post ' + defaultPrefix] = {model: resourceName, blueprint: 'create', resource: resourceName};
			resourceRoutes['put ' + defaultPrefix + '/:id'] = {model: resourceName, blueprint: 'update', resource: resourceName};
			resourceRoutes['delete ' + defaultPrefix + '/:id'] = {model: resourceName, blueprint: 'destroy', resource: resourceName};
			//TODO: add 'add,remove, and populate' for associations
		}
		if (actions) {
			//Load controller actions
			Object.keys(controller).forEach(function(actionName) {
				if (_.contains(['globalId', 'identity'], actionName)) return;
				resourceRoutes['get ' + defaultPrefix + '/' + actionName] = {controller: resourceName, action: actionName, resource: resourceName};
				resourceRoutes['post ' + defaultPrefix + '/' + actionName] = {controller: resourceName, action: actionName, resource: resourceName};
				resourceRoutes['put ' + defaultPrefix + '/' + actionName] = {controller: resourceName, action: actionName, resource: resourceName};
				resourceRoutes['delete ' + defaultPrefix + '/' + actionName] = {controller: resourceName, action: actionName, resource: resourceName};
			});
		}

	});

	var customRoutes = _config.routes;

	//Add the custom routes
	Object.keys(customRoutes).forEach(function(path) {
		//TODO handle casing in path (for example POST and post)
		var target = customRoutes[path];
		if (typeof target === 'string') {
			//TODO: Parse the string
			console.error('  Error: Parsing route target in string format is not yet supported');
		} else if (target instanceof Object) {
			if (target.model) target.resource = target.model.lowerFirst();
			if (target.controller) target.resource = target.controller.lowerFirst();
		}
		resourceRoutes[path] = target;
	});
	_routes = resourceRoutes;

}

/**
 * From the values in _routes, gets the docs for the actions associated with each route as well as the properties for each resource
 * 
 * @returns {Array} Array of docs and routes for each resource.  Each element has the properties 'name' (the resource name), 'dox' (the docs in dox format), and 'routes' (the routes associated with the resource)
 */
function _mergeDocs() {

	var result = [];

	//Move the 'path' from key to property for _.groupBy
	Object.keys(_routes).forEach(function(path) {
		_routes[path].path = path;
	});

	var resources = _.groupBy(_routes, 'resource');

	//Get docs by resource
	Object.keys(resources).forEach(function(resourceName) {
		var resource = resources[resourceName];
		resourceName = resourceName.capitalize(); //Use capitalized resource now
		var resourceDocs = [];
		var routes = [];

		//Look over each resource's routes
		Object.keys(resource).forEach(function(key) {
			var route = resource[key];
			var actionDoc; //The destination for the dox object for this action
			var r = {path: route.path, target: {resource: resourceName}}; //Setup the route property

			//If the route target is in model/blueprint format load the blueprint documentation
			if (route.model) {
				r.target.method = route.blueprint;
				actionDoc = _.find(_blueprintDocs, function(doc) {
					return doc.ctx.name === route.blueprint;
				});
				actionDoc.receiver = resourceName; //TODO add string?
			}
			//If the route target is in controller/action format load the action documentation
			if (route.controller) {
				r.target.method = route.action;
				actionDoc = _.find(_controllerDocs[resourceName], function(doc) {
					return /*doc.ctx.receiver === resourceName && */doc.ctx.name === route.action;
				});
			}

			//If there is documentation for this route/action, add it to the docs for this resource
			if (actionDoc){
				routes = routes.concat([r]);
				resourceDocs = overwrite(resourceDocs, actionDoc, function(existingItem, newItem) {
					return existingItem.ctx.name === newItem.ctx.name;
				});
			}
		});

		//If this resource has routes that have documented actions, add the model properties and add the documentation to the result
		if (routes.length > 0) {
			if (_modelDocs[resourceName]) resourceDocs = resourceDocs.concat(_modelDocs[resourceName]);
			result = result.concat([{
				name: resourceName,
				dox: resourceDocs,
				routes: routes
			}]);
		}

	});

	return result;
}

/**
 * Load the documentation for the blueprint actions
 */
function _getBlueprintDocs() {
	var files = dir.collectFiles(_config.blueprintsDir, {ignore: null});

	_bluePrintDocs = {};

	var docs = [];

	//Parse each file
	files.forEach(function(file) {
		var comments = parse(path.join(_config.blueprintsDir, file), {});
		var actionName = _resourceFromFile(file);

		comments.forEach(function(comment) {
			//Only grab methods from blueprints
			if (comment.ctx.type === 'method' && comment.ctx.receiver === 'module'  && comment.ctx.name === 'exports') {
				comment = _normalizeDox(comment);
				comment.ctx.name = actionName;
				comment.ctx.receiver = 'exports';
				comment.ctx.string = actionName + '()';
				docs = docs.concat(comment);
			}
		});
	});

	_blueprintDocs = docs;
}

/**
 * Load the documentation for controller actions
 */
function _getControllerDocs() {
	var files = dir.collectFiles(_config.controllersDir, {ignore: null});

	_controllerDocs = {};

	//Parse each file
	files.forEach(function(file) {
		var comments = parse(path.join(_config.controllersDir, file), {});
		var resourceName = _resourceFromFile(file);
		comments.forEach(function(comment, index, comments) {
			comment = _normalizeDox(comment);
			comment.ctx.receiver = resourceName;
			comment.ctx.string = resourceName + '.' + comment.ctx.name + '()';
			comments[index] = comment;
		});

		_controllerDocs[resourceName] = comments;
	});
}

/**
 * Load the documentation for model attributes
 */
function _getModelDocs() {
	var files = dir.collectFiles(_config.modelsDir, {ignore: null});

	_modelDocs = {};

	files.forEach(function(file) {
		var comments = parse(path.join(_config.modelsDir, file), {});
		var resourceName = _resourceFromFile(file);
		var docs = [];
		comments.forEach(function(comment, index, comments) {
			//Only grab properties from the Model
			//TODO: grab computed properties as well
			if (comment.ctx.type === 'property') {
				comment = _normalizeDox(comment);
				comment.ctx.receiver = resourceName;
				comment.ctx.string = resourceName + '.' + comment.ctx.name;
				docs = docs.concat(comment);
			}
		});

		_modelDocs[resourceName] = docs;
	});
}

/**
 * Remove code and other excess information from dox comment
 * 
 * @param comment {Object} Raw comment
 * @returns {Object} Normalized comment
 */
function _normalizeDox(comment) {
	delete comment.code;
	delete comment.line;
	delete comment.codeStart;
	return comment;
}

/**
 * Add an item or collection to a collection, overwriting any existing items that return truthy values from the compare function
 * 
 * @param collection {Array} The collection to add to
 * @param item {Array|Object} The item or collection to add
 * @param compare {Function} Comparison function.  Should take two arguments (existingItem, newItem)
 * @returns The modified collection
 */
function overwrite(collection, item, compare) {
	if (item instanceof Array) {
		if (!collection) return item;

		item.forEach(doItem);
		return collection;
	}

	doItem(item);
	return collection;

	function doItem(i) {
		_.remove(collection, function(val) {
			return compare(val, i);
		});
		collection = collection.concat(i);
	}
}

/**
 * Recursively require all modules in a directory
 * 
 * @param options {Object|String} If an Object, can specify properties dirname, filter, and excludeDirs.  If a String, then it is the directory name 
 * @returns All of the modules specified by the directory and filter in 'options'
 */
function _requireAll(options) {
	if (typeof options === 'string') {
		options = {
				dirname: options,
				filter: /(.+)\.js(on)?$/,
				excludeDirs: /^\.(git|svn)$/
		};
	}

	var files = fs.readdirSync(options.dirname);
	var modules = {};

	function excludeDirectory(dirname) {
		return options.excludeDirs && dirname.match(options.excludeDirs);
	}

	files.forEach(function (file) {
		var filepath = options.dirname + '/' + file;
		if (fs.statSync(filepath).isDirectory()) {

			if (excludeDirectory(file)) return;

			modules[file] = requireAll({
				dirname: filepath,
				filter: options.filter,
				excludeDirs: options.excludeDirs
			});

		} else {
			var match = file.match(options.filter);
			if (!match) return;

			modules[match[1]] = require(filepath);
		}
	});

	return modules;
};

/**
 * Strips off '.' and everything following, as well as 'Controller'
 * 
 * @param fname {String} Name of the file
 * @returns {String} Name of the resource
 */
function _resourceFromFile(fname) {
	var t = fname.indexOf('.');
	var name = t > -1 ? fname.slice(0, t) : fname;
	t = name.indexOf('Controller');
	return t > -1 ? name.slice(0, t) : name;
}