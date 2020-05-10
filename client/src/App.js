import React, { useMemo, useState, useEffect } from 'react';
import Table from './Table';
import { Map, Marker, Popup, TileLayer } from 'react-leaflet';
import { Icon } from 'leaflet';
import logo from './logo.svg';
import './App.css';

export const icon = new Icon({
  iconUrl: '/drone.png',
  iconSize: [25,25],
});

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      apiResponse: "",
      dbResponse: [],
      dbTableHeadings: [],
      newestDrone: {},
      activeDrone: null,
      averageLatency: 0,
    };
  }

  callApi() {
    fetch("http://localhost:9000/testApi")
      .then(res => res.text())
      .then(res => this.setState({ apiResponse: res }))
      .catch(err => err);
  }

  callDb(endpoint) {
    let url = "http://localhost:9000/testDb/" + endpoint;
    fetch(url)
      .then(res => res.text())
      .then(res => {
        const excludeColumns = [
          'id',
          'alive',
          'event_time',
          'ttl',
          'serviceIdNumber',
        ];
        const dbTable = JSON.parse(res);
        let headings = [];
        let mostRecent = {
          mobileId: null,
          location: [],
        };
        const firstRow = dbTable[0];
        for (let key in firstRow) {
          if (firstRow.hasOwnProperty(key)) {
            if (!excludeColumns.includes(key)) {
              headings.push(key);
            }
            if (key === 'mobileId') {
              mostRecent.mobileId = firstRow[key];
            }
            if (key === 'latitude') {
              mostRecent.location[0] = firstRow[key];
            }
            if (key === 'longitude') {
              mostRecent.location[1] = firstRow[key];
            }
            if (key === 'altitude_m') {
              mostRecent.location[2] = firstRow[key];
            }
          }
        }
        this.setState({
          dbTableHeadings: headings,
          dbResponse: dbTable,
          newestDrone: mostRecent,
        });
        this.calculateAverageLatency();
        //console.log(JSON.stringify(this.state));
      })
      .catch(err => err);
  }

  calculateAverageLatency() {
    let averageLatency = this.state.averageLatency;
    this.state.dbResponse.map(row => {
      if (averageLatency === 0) {
        averageLatency = row.latency;
      } else {
        averageLatency = Math.round((averageLatency + row.latency) / 2);
      }
    });
    this.setState({ averageLatency: averageLatency });
    //return averageLatency;
  }

  getNewestLocationData() {
    //WTF this does not work
    //location = [lat, lng, alt]
    const newest = this.state.dbResponse[0];
    const location = [
      newest.latitude,
      newest.longitude,
      newest.altitude_m,
    ];
    console.log(JSON.stringify(location));
    //return location;
  }

  componentDidMount() {
    this.callApi();
    this.callDb("uav");
  }

  render() {
    return (
      <div className="App">
        <header className="App-header">
          <h1 className="App-title">IDP UAV Test Data</h1>
        </header>
        <div className="uav-map">
          <Map center={this.state.newestDrone.location} zoom={12}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
            />
            <Marker
              key={this.state.newestDrone.mobileId}
              position={this.state.newestDrone.location}
              onClick={() => {
                this.getNewestLocationData();
                this.setState({ activeDrone: true });
              }}
              icon={icon}
            />

            {this.state.activeDrone && (
              <Popup
                position={this.state.newestDrone.location}
                onClose={() => {
                  this.setState({ activeDrone: null });
                }}
              >
                <div>
                  <h2>{this.state.newestDrone.mobileId}</h2>
                </div>
              </Popup>
            )}
          </Map>
        </div>
        <div className="average-latency">Average Message Latency: {this.state.averageLatency} seconds</div>
        <div>
          <table className="table-dark">
            <thead>
              <tr key="headings">
                {this.state.dbTableHeadings.map(heading => {
                  return (
                    <th key={heading}>{heading}</th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {this.state.dbResponse.map(loc => {
                return (
                  <tr key={loc.id}>
                    {this.state.dbTableHeadings.map(hdg => {
                      return (<td key={hdg} align="left">{loc[hdg]}</td>);
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
}

export default App;

/*
            <Marker
              key={this.state.activeDrone.mobileId}
              position={[
                this.state.activeDrone.latitude,
                this.state.activeDrone.longitude
              ]}
              icon={icon}
            />

*/