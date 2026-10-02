// Weather thresholds follow IMD definitions. Editable from the admin panel in V2 (S9).
export const WEATHER_THRESHOLDS = {
  heavyRainMm: 64.5, // IMD "heavy rainfall" (24 h)
  galeGustKmh: 62, // Beaufort 8 "gale"
  heatwaveMaxC: 40, // IMD heatwave threshold for the plains
};

export const MONITORED_CITIES = [
  { id: 'mumbai', name: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { id: 'delhi', name: 'Delhi', lat: 28.6139, lon: 77.209 },
  { id: 'kolkata', name: 'Kolkata', lat: 22.5726, lon: 88.3639 },
  { id: 'chennai', name: 'Chennai', lat: 13.0827, lon: 80.2707 },
  { id: 'bengaluru', name: 'Bengaluru', lat: 12.9716, lon: 77.5946 },
  { id: 'hyderabad', name: 'Hyderabad', lat: 17.385, lon: 78.4867 },
  { id: 'ahmedabad', name: 'Ahmedabad', lat: 23.0225, lon: 72.5714 },
  { id: 'pune', name: 'Pune', lat: 18.5204, lon: 73.8567 },
  { id: 'surat', name: 'Surat', lat: 21.1702, lon: 72.8311 },
  { id: 'jaipur', name: 'Jaipur', lat: 26.9124, lon: 75.7873 },
  { id: 'lucknow', name: 'Lucknow', lat: 26.8467, lon: 80.9462 },
  { id: 'patna', name: 'Patna', lat: 25.5941, lon: 85.1376 },
  { id: 'bhopal', name: 'Bhopal', lat: 23.2599, lon: 77.4126 },
  { id: 'nagpur', name: 'Nagpur', lat: 21.1458, lon: 79.0882 },
  { id: 'bhubaneswar', name: 'Bhubaneswar', lat: 20.2961, lon: 85.8245 },
  { id: 'visakhapatnam', name: 'Visakhapatnam', lat: 17.6868, lon: 83.2185 },
  { id: 'guwahati', name: 'Guwahati', lat: 26.1445, lon: 91.7362 },
  { id: 'kochi', name: 'Kochi', lat: 9.9312, lon: 76.2673 },
  { id: 'thiruvananthapuram', name: 'Thiruvananthapuram', lat: 8.5241, lon: 76.9366 },
  { id: 'dehradun', name: 'Dehradun', lat: 30.3165, lon: 78.0322 },
  { id: 'shimla', name: 'Shimla', lat: 31.1048, lon: 77.1734 },
  { id: 'srinagar', name: 'Srinagar', lat: 34.0837, lon: 74.7973 },
  // Gujarat (pilot region for the demo)
  { id: 'gandhinagar', name: 'Gandhinagar', lat: 23.2156, lon: 72.6369 },
  { id: 'vadodara', name: 'Vadodara', lat: 22.3072, lon: 73.1812 },
  { id: 'rajkot', name: 'Rajkot', lat: 22.3039, lon: 70.8022 },
  { id: 'bhavnagar', name: 'Bhavnagar', lat: 21.7645, lon: 72.1519 },
  { id: 'junagadh', name: 'Junagadh', lat: 21.5222, lon: 70.4579 },
  { id: 'porbandar', name: 'Porbandar', lat: 21.6417, lon: 69.6293 },
  { id: 'bhuj', name: 'Bhuj', lat: 23.2420, lon: 69.6669 },
  { id: 'palanpur', name: 'Palanpur', lat: 24.1724, lon: 72.4380 },
] as const;
