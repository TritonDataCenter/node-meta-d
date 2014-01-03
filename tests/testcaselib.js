/*
 * testcaselib.js: common code for running simple Meta-D test cases.
 */

var mod_fs = require('fs');
var mod_path = require('path');

var mod_krill = require('krill');
var mod_metad = require('../lib/meta-d');

exports.runTestCases = runTestCases;

/*
 * Runs a set of test cases using a single Meta-D input file.  "args" should
 * have:
 *
 *     name		the name of the test, which is expected to a filename in
 *     			the same directory as this library, and there should be
 *     			only one call to this function from each such file
 *     			(because error output is saved with a filename derived
 *     			from this name)
 *
 *     input		the Meta-D input file
 *
 *     fieldtypes	krill-style metadata for the fields
 *
 *     cases		list of cases describing specific scripts to
 *     			instantiate, each of which should have "predicate" and
 *     			"decomposition" and may also have "zones"
 */
function runTestCases(args)
{
	console.log('test suite "%s"', args.name);

	mod_metad.mdValidateMetaD(args.input);

	var out = '';
	var expected_out = mod_fs.readFileSync(
	    mod_path.join(__dirname, args.name + '.out'));

	args.cases.forEach(function (params, i) {
		var rv, mdparams;

		console.log('case %d:', i);
		if (params.zones)
			console.log('    zones = [ %s ]',
			    params.zones.join(', '));
		console.log('    decomposition = [ %s ]',
		    params.decomposition.join(', '));
		console.log('    predicate = %s',
		    JSON.stringify(params.predicate));

		mdparams = {
		    'zones': params.zones || null,
		    'decomposition': params.decomposition,
		    'predicate': mod_krill.createPredicate(params.predicate)
		};
		rv = mod_metad.mdGenerateDScript(args.input, mdparams,
		    args.fieldtypes);

		out += [
		    '/*\n',
		    ' * test case ' + i + ':\n',
		    ' *     zones = ' +
			JSON.stringify(params.zones || []) + '\n',
		    ' *     predicate = ' +
			JSON.stringify(params.predicate) + '\n',
		    ' *     decomps = ' +
			JSON.stringify(params.decomposition) + '\n',
		    ' */\n'
		].join('');

		rv.scripts.forEach(function (s, j) {
			out += '/* start script ' + j + ' */\n';
			out += s;
			out += '/* end script ' + j + ' */\n\n';
		});
	});

	if (out == expected_out)
		return;

	var badout = mod_path.join(__dirname, args.name + '.' + process.pid);
	console.error('ERROR: expected output mismatch. saving output to %s',
	    badout);
	mod_fs.writeFileSync(badout, out);
	throw (new Error('expected output mismatch'));
}
