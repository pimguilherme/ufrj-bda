var
    newick = require('./lib/newick')
    , neo4j = require('neo4j')
    , util = require('util')

/**
 * Helpers
 */
var error = (function (name) {
    return function (m) {
        throw new Error(name + ": " + m + ' ' + util.inspect(Array.prototype.slice.call(arguments, 1)))
    }
})('Newick2Neo4j')

/**
 * Tree parsing..
 *
 * Here we need a tree which will be identified by its 'name' property, and
 * its structured will be parsed from its Newick representation.
 *
 * We'll then proceed to establish the tree in Neo4j.
 */
var tree = {
    name:'XXX',
    newick:'(3:0.22600665976405817648,(2:0.24586044154417141527,(1:0.95659174989638406927,4:0.79869723538484571623)86:0.43223620036001075828)63:0.06949250737937846811,5:0.22062446543725264259);'
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
                node.createRelationshipTo(childNode, 'CHILD', {length:childParsedNode.length}, function () {
                    next()
                })
            })
        })

        // If there are no pending requests above, we are done
        next(true)

    })
}

// Overriding the tree's root name, to reflect the name we have given
tree.parsed.name = tree.name;
saveParsedNode(tree.parsed, function (root) {
    console.log('Everything has been saved!', JSON.stringify(root, null, 4));
})