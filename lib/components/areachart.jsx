/*
 * ESnet React Charts, Copyright (c) 2014, The Regents of the University of
 * California, through Lawrence Berkeley National Laboratory (subject
 * to receipt of any required approvals from the U.S. Dept. of
 * Energy).  All rights reserved.
 *
 * If you have questions about your rights to use or distribute this
 * software, please contact Berkeley Lab's Technology Transfer
 * Department at TTD@lbl.gov.
 *
 * NOTICE.  This software is owned by the U.S. Department of Energy.
 * As such, the U.S. Government has been granted for itself and others
 * acting on its behalf a paid-up, nonexclusive, irrevocable,
 * worldwide license in the Software to reproduce, prepare derivative
 * works, and perform publicly and display publicly.  Beginning five
 * (5) years after the date permission to assert copyright is obtained
 * from the U.S. Department of Energy, and subject to any subsequent
 * five (5) year renewals, the U.S. Government is granted for itself
 * and others acting on its behalf a paid-up, nonexclusive,
 * irrevocable, worldwide license in the Software to reproduce,
 * prepare derivative works, distribute copies to the public, perform
 * publicly and display publicly, and to permit others to do so.
 *
 * This code is distributed under a BSD style license, see the LICENSE
 * file for complete information.
 */

import React from "react/addons";
import d3 from "d3";
import _ from "underscore";
import {TimeSeries} from "@esnet/pond";

function scaleAsString(scale) {
    return `${scale.domain()}-${scale.range()}`;
}

/**
 * Build up our data from the series. For each layer in the up (or down)
 * direction, layer, we have layer.values = [points] where each point is
 * in the format {data: .., value, ..}
 */
function getLayers(series) {
    return {
        "upLayers": series[0].map(function(series) {
            let points = [];
            for (let i=0; i < series.size(); i++) {
                let point = series.at(i);
                points.push({"date": point.timestamp(), "value": point.get()});
            }
            return {"values": points };
        }),

        "downLayers": series[1].map(function(series) {
            let points = [];
            for (let i=0; i < series.size(); i++) {
                let point = series.at(i);
                points.push({"date": point.timestamp(), "value": point.get()});
            }
            return {"values": points };
        })
    }
}

/**
 * Build a D3 area generator based on the interpolate method and the supplied
 * timeScale and yScale. The result is an SVG area.
 *
 *   y|    |||  +y1   ||||||
 *    |||||||||||||||||||||||||
 *    | |||     +y0      |||||||||<-area
 *    |
 *    +---------|---------------- t
 *              x
 */
function getAreaGenerators(interpolate, timeScale, yScale) {
    let upArea = d3.svg.area()
        .x(d => timeScale(d.date))
        .y0(d => yScale(d.y0))
        .y1(d => yScale(d.y0 + d.value))
        .interpolate(interpolate);

    let downArea = d3.svg.area()
        .x(d => timeScale(d.date))
        .y0(d => yScale(d.y0))
        .y1(d => yScale(d.y0 - d.value))
        .interpolate(interpolate);

    return {"upArea": upArea, "downArea": downArea};
}

/**
 * Our D3 stack. When this is evoked with data (an array of layers) it builds up
 * the stack of graphs on top of each other (i.e propogates a baseline y position
 * up through the stack).
 */
function getAreaStackers() {
    return {
        "stackUp": d3.layout.stack()
            .values(d => d.values)
            .x(d => d.date)
            .y(d => d.value),

        "stackDown": d3.layout.stack()
            .values(d => d.values)
            .x(d => d.date)
            .y(d => -d.value)
    }
}

function getCroppedSeries(scale, width, seriesList) {
    const beginTime = scale.invert(0);
    const endTime = scale.invert(width);
    return _.map(seriesList, direction => {
        return _.map(direction, series => {
            const beginIndex = series.bisect(beginTime);
            const endIndex = series.bisect(endTime);
            const cropped = series.slice(beginIndex, endIndex === series.size() - 1 ?
                                         endIndex : endIndex + 1);
            return cropped;
        });
    });
}

/**
 * Draws an area chart
 */
export default React.createClass({

    displayName: "AreaChart",

    propTypes: {
        /**
         * Time in ms to transition the chart when the axis changes scale
         */
        transition: React.PropTypes.number,

        /**
         * The d3 interpolation method
         */
        interpolate: React.PropTypes.string,

        /**
         * The style of the area chart, with format:
         *
         *  "style": {
         *      up: ["#448FDD", "#75ACE6", "#A9CBEF", ...],
         *      down: ["#FD8D0D", "#FDA949", "#FEC686", ...]
         *  }
         *
         *  Where each color in the array corresponds to each area stacked
         *  either up or down.
         */
        style: React.PropTypes.shape({
            "up": React.PropTypes.arrayOf(React.PropTypes.string),
            "down": React.PropTypes.arrayOf(React.PropTypes.string)
        }),

        /**
         * The series list. This is a 2 element array, with the first element
         * build stacked up and the second element being stacked down. Each
         * element is itself an array of TimeSeries.
         */
        series: React.PropTypes.arrayOf(React.PropTypes.arrayOf(React.PropTypes.instanceOf(TimeSeries)))
    },

    getDefaultProps() {
        return {
            "transition": 0,
            "interpolate": "step-after",
            "style": {
                up: ["#448FDD", "#75ACE6", "#A9CBEF"],
                down: ["#FD8D0D", "#FDA949", "#FEC686"]
            }
        };
    },

    /**
     * Checks if the passed in point is within the bounds of the drawing area
     */
    inBounds(p) {
        return p[0] > 0 && p[0] < this.props.width;
    },

    renderAreaChart(series, timeScale, yScale, interpolate, isPanning) {
        if (!yScale || !series[0]) {
            return null;
        }

        let style = {
            "fill": this.props.style.color,
            "stroke": "none"
        }

        d3.select(this.getDOMNode()).selectAll("*").remove();

        const croppedSeries = getCroppedSeries(timeScale, this.props.width, series);

        let {upArea, downArea} = getAreaGenerators(interpolate, timeScale, yScale);
        let {upLayers, downLayers} = getLayers(croppedSeries);
        let {stackUp, stackDown} = getAreaStackers();

        //Stack our layers
        stackUp(upLayers);
        if (downLayers.length) {
            stackDown(downLayers);
        }

        //Cursor
        const cursor = isPanning ? "-webkit-grabbing" : "default";

        //
        // Stacked area drawing up
        //

        //Make a group 'areachart-up-group' for each stacked area
        let upChart = d3.select(this.getDOMNode())
            .selectAll(".areachart-up-group")
                .data(upLayers)
            .enter().append("g")
                .attr("id", () => _.uniqueId("areachart-up-"))

        // Append the area chart path onto the areachart-up-group group
        this.upChart = upChart
            .append("path")
                .style("fill", (d, i) => this.props.style.up[i])
                .style("pointerEvents", "none")
                .style("cursor", cursor)
                .attr("d", d => upArea(d.values))
                .attr("clip-path", this.props.clipPathURL);

        //
        // Stacked area drawing down
        //

        //Make a group 'areachart-down-group' for each stacked area
        let downChart = d3.select(this.getDOMNode()).selectAll(".areachart-down-group")
            .data(downLayers)
          .enter().append("g")
            .attr("id", () => _.uniqueId("areachart-down-"))

        // Append the area chart path onto the areachart-down-group group
        this.downChart = downChart
            .append("path")
                .style("fill", (d, i) => this.props.style.down[i])
                .style("pointerEvents", "none")
                .style("cursor", cursor)
                .attr("d", d => downArea(d.values))
                .attr("clip-path", this.props.clipPathURL);
    },

    updateAreaChart(series, timeScale, yScale, interpolate) {
        const croppedSeries = getCroppedSeries(timeScale, width, series);
        let {upArea, downArea} = getAreaGenerators(interpolate, timeScale, yScale);
        let {upLayers, downLayers} = getLayers(croppedSeries);
        let {stackUp, stackDown} = getAreaStackers();

        //Stack our layers
        stackUp(upLayers);
        if (downLayers.length) {
            stackDown(downLayers);
        }

        this.upChart
            .transition()
            .duration(this.props.transition)
            .ease("sin-in-out")
            .attr("d", d => upArea(d.values));

        this.downChart
            .transition()
            .duration(this.props.transition)
            .ease("sin-in-out")
            .attr("d", d => downArea(d.values));

    },

    componentDidMount() {
        this.renderAreaChart(this.props.series, this.props.timeScale,
                             this.props.yScale, this.props.interpolate);
    },

    componentWillReceiveProps(nextProps) {
        let newSeries = nextProps.series;
        let oldSeries = this.props.series;

        let timeScale = nextProps.timeScale;
        let yScale = nextProps.yScale;
        let interpolate = nextProps.interpolate;

        let isPanning = nextProps.isPanning;

        //What changed
        let timeScaleChanged = (scaleAsString(this.props.timeScale) !== scaleAsString(timeScale));
        let yAxisScaleChanged = (scaleAsString(this.props.yScale) !== scaleAsString(yScale));
        let interpolateChanged = (this.props.interpolate !== interpolate);
        let isPanningChanged = (this.props.isPanning !== isPanning);

        let seriesChanged = false;
        if (oldSeries[0].length !== newSeries[0].length ||
            oldSeries[0].length !== newSeries[0].length) {
            seriesChanged = true;
        } else {
            for (let d=0; d < 2; d++) {
                for (let a=0; a < oldSeries[d].length; a++) {
                    let o = oldSeries[d][a];
                    let n = newSeries[d][a];
                    if (!TimeSeries.is(o, n)) {
                        seriesChanged = true;
                    }
                }
            }
        }

        //
        // Currently if the series changes we completely rerender it. If the y axis scale
        // changes then we just update the existing paths using a transition so that we
        // can get smooth axis transitions.
        //

        if (seriesChanged || timeScaleChanged || interpolateChanged || isPanningChanged) {
            this.renderAreaChart(newSeries, timeScale, yScale, interpolate, isPanning);
        } else if (yAxisScaleChanged) {
            this.updateAreaChart(newSeries, timeScale, yScale, interpolate);
        }
    },

    shouldComponentUpdate() {
        return false;
    },

    render() {
        return (
            <g></g>
        );
    }
});
