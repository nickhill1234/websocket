const crypto = require("crypto")
const WebSocket = require("ws")
const wss = new WebSocket.Server({ port: 8000 });

const apiKey = "e7510a1f624e9f2fa5d059c8916091eac03cefedde2cab096e5daec2ac7ae11a"
const apiKeySecret = "35c820252c33aadf32ed7c99f0dd704cc63990c5c8b24b1a153d71abbaf97015"
function signRequest(apiKeySecret, timestamp, verb, path, body = "") {
  return crypto
    .createHmac("sha512", apiKeySecret)
    .update(timestamp.toString())
    .update(verb.toUpperCase())
    .update(path)
    .update(body)
    .digest("hex")
}
function getAuthHeaders(path) {
  var headers = new Object()
  var timestamp = new Date().getTime()
  var signature = signRequest(apiKeySecret, timestamp, "GET", path, "")
  headers["X-VALR-API-KEY"] = apiKey
  headers["X-VALR-SIGNATURE"] = signature
  headers["X-VALR-TIMESTAMP"] = timestamp
  return headers
}

/*Trade WebSocket connection*/
let fullOrderbookSnapshot = { Asks: [], Bids: [] };

function updateOrderbookSnapshot(fullOrderbookSnapshot, orderbookUpdate) {
  for (const priceLevel of orderbookUpdate) {
    const { Orders, Price } = priceLevel;
    console.log('New order update price level '+priceLevel.Price, 'And orders are', priceLevel.Orders)

    // Find the matching price level in the full order book
    const matchingPrice = fullOrderbookSnapshot.Asks.find(p => p.Price === Price);
    if (matchingPrice) {
      console.log('Matching price level found:', matchingPrice);

      // Loop through each order in the price level
      for (const order of Orders) {
        const { orderId, quantity } = order;

        if (quantity === '0') {
          // Remove the order if the quantity is zero
          matchingPrice.Orders = matchingPrice.Orders.filter(o => o.orderId !== order.orderId);
          console.log('Removed order with ID', orderId, 'and quantity', quantity);
        }
        else if (quantity > 0) {
          // Update the quantity of the matching order
          const matchingOrder = matchingPrice.Orders.find(o => o.orderId === orderId);
          if (matchingOrder) {
            matchingOrder.quantity = parseFloat(quantity);
            console.log('Updated order with ID', orderId, 'and new quantity', quantity);
          } else {
          // Add an order at the existing price level if there is not previous order to update
            const newOrder = { orderId, quantity: parseFloat(quantity) };
            matchingPrice.Orders.push(newOrder);
            console.log('Added new order with ID', orderId, 'and quantity', quantity);
          }
        } else {
          console.log('Invalid quantity for order with ID', orderId);
        }
      }
    } else {
      console.log('No matching price level found for price', Price);
      fullOrderbookSnapshot.Asks.push({ Price, Orders: [Orders] });
      console.log('Added new price level with price', Price, 'and orders', Orders);
    }
  }
}



function connectToTrade() {
    var headers = getAuthHeaders("/ws/trade")
    const ws = new WebSocket('wss://api.valr.com/ws/trade', { headers })
    
    var message = {
        "type": "SUBSCRIBE",
        "subscriptions": [
          {
            "event": "FULL_ORDERBOOK_UPDATE",
            "pairs": [
              "BTCZAR"
            ]
          }
        ]
      }
      

    ws.on('open', () =>  {
        /* Once the connection is open, you subscribe to an event here */
        console.log('Trade WS connected')
        ws.send(JSON.stringify(message))
    })
    ws.on("message", data => {

        try {
            const message = JSON.parse(data.toString())

            if (message && message.data && message.type =='FULL_ORDERBOOK_SNAPSHOT') {
                console.log('Starting FULL_ORDERBOOK_SNAPSHOT ');
                fullOrderbookSnapshot = {
                  Asks: message.data.Asks,
                  Bids: message.data.Bids
                };                
                console.log('Finished FULL_ORDERBOOK_SNAPSHOT ',fullOrderbookSnapshot );
            } else if (message && message.data && message.data.Asks && message.data.Asks[0] && message.data.Asks[0].Price) {
                const orderbookUpdate = message.data.Asks
                updateOrderbookSnapshot(fullOrderbookSnapshot,orderbookUpdate)
                wss.clients.forEach(client => {
                  client.send(JSON.stringify(message));
                });
            } else {
              console.log("Received unexpected message:", message)
            }
          } catch (error) {
            console.log("Error parsing message:", error)
          }
      })
    ws.on("error", err => {
        console.log('Error')
    })
    ws.on("close", () => {
        console.log('Connection closed. Reconnecting...')
        setTimeout(() => {
          connectToTrade()
        }, 10000) // wait 10 seconds before reconnecting
    })
}
connectToTrade()

