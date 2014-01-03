var mod_path = require('path');
var mod_testcaselib = require('./testcaselib');

mod_testcaselib.runTestCases({
    'name': mod_path.basename(__filename),
    'fieldtypes': {
	'terra': 'string',
	'celes': 'number'
    },
    'input': {
	'fields': [ 'terra', 'celes' ],
	'metad': {
		'usepragmazone': true,
		'probedesc': [ {
			'probes': [ 'syscall:::entry' ],
			'gather': {
				'celes': {
					'gather': 'vtimestamp',
					'store': 'thread'
				}
			}
		}, {
			'probes': [ 'syscall:::return' ],
			'aggregate': {
				'default': 'count()',
				'terra': 'count()',
				'celes': 'quantize($0)'
			},
			'transforms': {
				'terra': 'zonename',
				'celes': 'timestamp - $0'
			},
			'verify': {
				'celes': '$0'
			}
		}, {
			'probes': [ 'syscall:::return' ],
			'clean': {
				'celes': '$0'
			}
		} ]
	}
    },
    'cases': [ {
	/* simple case */
	'predicate': {},
	'decomposition': []
    }, {
	/*
	 * uses "#pragma D option zone" as well as a zone predicate that gets
	 * combined with the existing predicates
	 */
	'zones': [ 'zone1', 'zone2' ],
	'predicate': { 'gt': [ 'celes', 10 ] },
	'decomposition': []
    }, {
	/* like previous, but too many zones to use the #pragma */
	'zones': [ 'zone1', 'zone2', 'zone3', 'zone4', 'zone5' ],
	'predicate': { 'gt': [ 'celes', 10 ] },
	'decomposition': []
    }, {
	/* decomposition combinations */
	'predicate': {},
	'decomposition': [ 'celes' ]
    }, {
	'predicate': {},
	'decomposition': [ 'terra' ]
    }, {
	'predicate': {},
	'decomposition': [ 'celes', 'terra' ]
    }, {
	/* predicates and decompositions */
	'predicate': { 'gt': [ 'celes', '300' ] },
	'decomposition': [ 'celes' ]
    }, {
	'predicate': { 'gt': [ 'celes', '300' ] },
	'decomposition': []
    }, {
	'predicate': { 'or': [
	    { 'eq': [ 'terra', 'global' ] },
	    { 'eq': [ 'terra', 'adm' ] }
	] },
	'decomposition': []
    } ]
});
