## Blog-Backend-REST-API-NestJS-Prisma 

A simple backend REST API for a blog built using NestJS, Prisma, PostgreSQL and Swagger. 

### Installation

1. Install dependencies: `npm install`
2. Start a PostgreSQL database with docker using: `docker-compose up -d`. 
    - If you have a local instance of PostgreSQL running, you can skip this step. In this case, you will need to change the `DATABASE_URL` inside the `.env` file with a valid [PostgreSQL connection string](https://www.prisma.io/docs/concepts/database-connectors/postgresql#connection-details) for your database. 
3. Apply database migrations: `npx prisma migrate dev` 
4. Start the project:  `npm run start:dev`
5. Access the project at http://localhost:3000/api



### Setup DB

Run `npm run prisma:reset`



### Data to Play with

Users :

| id | email | password |  
| :--- | :--- | :--- |  
| 1 | javier@upwork.com | zaq1@WSX |  
| 2 | john@upwork.com | zaq1@WSX |  
| 3 | jack@upwork.com | zaq1@WSX |


Rooms:

| id | name | description |
| :--- | :--- | :--- |
| 1000 | Lab room 1 | Lab room Linux env |
| 1001 | Lab room 2 | Lab room Win env |
| 1002 | Lab room 3 | Lab room Apple env |



Room Schedules:

| scheduleId | scheduleName | startTime | totalMin |
| :--- | :--- | :--- | :--- |
| bfedd044-381a-44f0-8c6d-ca9fb9aabf0b | Lab 1 Morning | 09:00 | 60 |
| 588ca14a-7482-4610-a816-ba3be58410f7 | Lab 2 Morning | 09:00 | 90 |
| 83ccd46c-3894-42c7-827c-484edef1022c | Lab 3 Morning | 09:00 | 90 |
| 2ade155c-a851-4574-9abe-2c1dd6d20878 | Lab 1 Noon | 12:00 | 90 |
| 6b5a55ab-6afc-461c-b984-a2cbfe5b260f | Lab 2 Noon | 12:00 | 90 |
| 3176c97b-b3b0-4008-b337-1456c5ff4761 | Lab 3 Noon | 12:00 | 90 |
| 3625ff92-f3d3-4916-9403-a449b1c829ef | Lab 1 Evening | 17:00 | 90 |
| e2c763e0-08e4-4b75-b720-09b11c65d0db | Lab 2 Evening | 17:00 | 90 |
| d4aa75cc-6d68-4592-82ae-34bad3e2f358 | Lab 3 Evening | 17:00 | 120 |


#### Data Model:

![img.png](documentation/data_model.png)


### Swagger Doc

http://localhost:3000/open-api


![img_1.png](documentation/swagger.png)


## Usage:

### Login

Users :

| id | email | password |  
| :--- | :--- | :--- |  
| 1 | javier@upwork.com | zaq1@WSX |  
| 2 | john@upwork.com | zaq1@WSX |  
| 3 | jack@upwork.com | zaq1@WSX |


```json
{
  "email": "string",
  "password": "string"
}
```

##### Consume Login endpoint:

```shell
curl -X 'POST' \
  'http://localhost:3000/auth/login' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "email": "string",
  "password": "string"
}'

```

##### Get Room Activities endpoint:

```shell
curl -X 'POST' \
  'http://localhost:3000/auth/login' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "email": "string",
  "password": "string"
}'

```
