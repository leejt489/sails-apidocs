
var appDir = process.cwd();
var _routeFile = appDir+ '/config/routes.js';

module.exports = {
		
		appDir: appDir,
		
		template: appDir + '/node_modules/sails-apidocs/views/template.jade',
		
		targetDir: 'assets/docs',
		
		blueprints: require(appDir + '/config/blueprints.js').blueprints,
		
		routes: require(_routeFile).routes,
		
		policies: require(appDir + '/config/policies.js').policies,
		
		controllersDir: appDir + '/api/controllers',
		
		modelsDir: appDir + '/api/models',
		
		//TODO: enable multiple directories
		blueprintsDir: appDir + '/node_modules/sails/lib/hooks/blueprints/actions',
		
		policiesDir: appDir + '/api/policies',
		
		routeFile: _routeFile
}