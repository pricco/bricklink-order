# bricklink-order

Apply the Simplex alghorithm to find the best sellers for a wanted list on BrickLink.

Idea and Simplex algorithm from https://github.com/giacecco/bricklink-helper. Thank you.

## Setup

* Install Docker
* Build Docker's images: `docker-compose build`

## Run

* `docker-compose up -d`
* SSH into the container: `docker exec -it "bricklink-order" /bin/bash`
* Run the script: `./bo.js -u your_bricklink_username -p your_password -w wanted_list_id`


## Licence

![Creative Commons License](http://i.creativecommons.org/l/by/4.0/88x31.png "Creative Commons License") This work is licensed under a [Creative Commons Attribution 4.0 International](http://creativecommons.org/licenses/by/4.0/).
