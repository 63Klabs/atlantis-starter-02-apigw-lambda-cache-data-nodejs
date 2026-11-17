# Documentation for End-Users

## Use the service endpoint

Send requests to the service's published endpoint, the one you were given for the application. A request that does not come through the service endpoint, for example one sent straight to the underlying `execute-api` address of the API, is refused with status `401`. The response has a JSON body such as `{"message":"Requests must use the service endpoint."}` and the header `Cache-Control: no-store`, so it is not cached. If you get this response and you are using the published endpoint, contact the service owner.
