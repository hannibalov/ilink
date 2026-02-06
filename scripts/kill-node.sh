#!/bin/bash
# Script to kill all Node.js processes
# Usage: ./scripts/kill-node.sh

echo "Finding all Node.js processes..."
ps aux | grep node | grep -v grep

echo ""
read -p "Kill all Node.js processes? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]
then
    echo "Killing all Node.js processes..."
    pkill -f node
    sleep 1
    
    # Check if any are still running
    REMAINING=$(ps aux | grep node | grep -v grep | wc -l)
    if [ $REMAINING -gt 0 ]; then
        echo "Some processes still running, using force kill..."
        pkill -9 -f node
    fi
    
    echo "Done. Remaining Node.js processes:"
    ps aux | grep node | grep -v grep
else
    echo "Cancelled."
fi
