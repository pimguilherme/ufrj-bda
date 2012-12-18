var
    newick = require('./lib/newick')
    , neo4j = require('neo4j')
    , util = require('util')
    , fs = require('fs')

/**
 * Helpers
 */
var error = (function (name) {
    return function (m) {
        throw new Error(name + ": " + m + ' ' + util.inspect(Array.prototype.slice.call(arguments, 1)))
    }
})('Newick2Neo4j')

/**
 * CLI handler
 */

var cliTreeId = process.argv[2]
    , cliFilepath = process.argv[3]

// Usage validation
if (!cliTreeId || !cliFilepath) {
    console.log('');
    console.log(' Usage: parse <tree_id> <filepath>')
    console.log(' --');
    console.log(' Parameters:');
    console.log("\t<tree_id> is a string which will identify the parsed tree in Neo4j");
    console.log("\t<filepath> is the path to a file containing a tree in the NEWICK format");
    console.log('');
    process.exit()
}

// Parameters validation
cliTreeId = cliTreeId.trim()
if (!cliTreeId.length) {
    console.log(' <tree_id> should not be blank.');
    process.exit()
}

if (!fs.existsSync(cliFilepath)) {
    console.log(' <filepath> is invalid, file "' + cliFilepath + '" not found.');
    process.exit()
}


/**
 * Tree parsing..
 *
 * Here we need a tree which will be identified by its 'name' property, and
 * its structure will be parsed from its Newick representation.
 *
 * We'll then proceed to establish the tree in Neo4j.
 */
var tree = {
    name:cliTreeId,
    newick:fs.readFileSync(cliFilepath)
};

tree.parsed = newick.parse(tree.newick)
// Oops, don't know what to do!
if (!tree.parsed || !tree.parsed.branchset) {
    error('Invalid newick input, couldn\'t parse tree.')
}

/**
 * Neo4j representation of our tree
 */
var db = new neo4j.GraphDatabase('http://localhost:7474')

// Recursive function to save a parsed newick node into Neo4j
var saveParsedNode = function (parsedNode, done) {

    // Neo4j node representation of our parsed node
    var node = db.createNode({
        name:parsedNode.name,
        bootstrap:parsedNode.bootstrap
    })

    node.save(function (err) {
        if (err) error('Couldn\'t save a node', err)

        // Basic async flow control
        var total = 0
            , next = function (noDec) {
                if (!noDec) total--;
                if (total <= 0) {
                    // Finally done!
                    done(node)
                }
            }

        // Children and their relationships with the parent
        parsedNode.branchset && parsedNode.branchset.forEach(function (childParsedNode) {
            total++;
            saveParsedNode(childParsedNode, function (childNode) {
                node.createRelationshipTo(childNode, 'CHILD', {length:childParsedNode.length}, function (err) {
                    if (err) error('Failed to create relationship', err, parsedNode, childNode)
                    next()
                })
            })
        })

        // Adds the node to a generic index of nodes
        total += 2;
        node.index('all', 'name', parsedNode.name || '', function (err) {
            if (err) error('Failed to create a generic name index for a node', err, parsedNode, parsedNode.name)
            next()
        })
        node.index('all', 'bootstrap', parsedNode.bootstrap || null, function (err) {
            if (err) error('Failed to create a generic bootstrap index for a node', err, parsedNode, parsedNode.bootstrap)
            next()
        })

        // If there are no pending requests above, we are done
        next(true)

    })
}

var rootParsed = tree.parsed
// Overriding the tree's root name, to reflect the name we have given
rootParsed.name = tree.name;
saveParsedNode(rootParsed, function (root) {
    // We'll add the newick representation of the tree to the root, maybe it's useful later
    root.data.newick = tree.newick
    root.save(function (err) {
        if (err) error('Couldn\'t append the newick seed to the root')
        // The root node is added to an index of trees
        root.index('roots', 'name', rootParsed.name, function (err) {
            if (err) error('Failed to create a generic index for the root node', rootParsed, rootParsed.name)
            console.log('Everything has been saved!', JSON.stringify(root, null, 4));
        })
    })
})