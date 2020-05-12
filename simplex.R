# Source: https://github.com/giacecco/bricklink-helper/blob/master/bricklink-order-simplex.R

# Install and load any required packages
.requiredPackages <- c("Rsymphony")
.packagesToInstall <- setdiff(.requiredPackages, installed.packages())
if (length(.packagesToInstall) > 0) install.packages(.packagesToInstall)
sapply(.requiredPackages, require, character.only = TRUE)
# Set global option for read.csv
options(stringsAsFactors = FALSE)

# Read the data from the exchange folder.
args <- commandArgs(trailingOnly = TRUE)
parameters <- read.csv(paste0(if (!is.na(args[1])) args[1] else ".simplex", "/parameters.csv"))[1, ]
items <- read.csv(paste0(if (!is.na(args[1])) args[1] else ".simplex", "/items.csv"))
availability <- read.csv(paste0(if (!is.na(args[1])) args[1] else ".simplex", "/availability.csv"))

# Create the reference item id list. Note that I ignore both:
# a) the requirement for item ids that are not available on the market, and
# b) the availability of item ids that are not a requirement
# TODO: did I find a suitable place to warn the user about the items that
#       could not be found on the market?
item_id_references <- sort(intersect(unique(availability$id), unique(items$id)))
N <- length(item_id_references)

# Create the reference seller list. Note that I ignore the availability of
# items that are not in the reference items list created above.
store_references <- sort(unique(availability[availability$id %in% item_id_references, c('store')]))
M <- length(store_references)

# See the documentation at http://dico.im/1nBkI4i ; the following creates the
# elements of the integer linear programming problem as required to use the
# SYMPHONY library.

# quantities is a matrix with one row for each seller and one column for each
# item id
quantities <- t(sapply(store_references, function (store) {
    return(sapply(item_id_references, function (item_id) {
        quantities_per_seller <- availability[(availability$store == store) &
                                                  (availability$id == item_id), c("quantity")]
        return(if (length(quantities_per_seller) == 0) 0 else sum(quantities_per_seller))
    }, USE.NAMES = FALSE))
}, USE.NAMES = FALSE))

m <- as.vector(t(quantities))

# prices is a matrix witn one row for each seller and one column for each item
# id
prices <- t(sapply(store_references, function (store) {
    return(sapply(item_id_references, function (item_id) {
        prices_per_store <- availability[(availability$store == store) &
                                              (availability$id == item_id), ]$price
        return(if (length(prices_per_store) == 0) 0. else max(prices_per_store))
    }, USE.NAMES = FALSE))
}, USE.NAMES = FALSE))

# 'c' is a quite reserved word in R! :-)
c_ <- c(as.vector(t(prices)), rep(parameters$S, M))

r <- sapply(item_id_references, function (item_id) {
    q <- sum(items[items$id == item_id, c("quantity")])
    return(if(!is.na(q)) q else 0)
})

# 'T' is also reserved
T_ <- sum(r)

v <- sapply(store_references, function (store) {
    minBuy <- availability[availability$store == store, c("minBuy")][1]
    return(if(!is.na(minBuy)) minBuy else 0)
}, USE.NAMES = FALSE)

b <- c(r, m, rep(0, M), rep(0, M))

constraints <- c(rep("==", N), rep("<=", N * M), rep("<=", M), rep(">=", M))

# Just for testing: if any value in the
# no_of_sellers_who_can_offer_the_whole_quantity is zero, something is wrong
# as at least one seller is supposed to exist who can offer the whole number
# of pieces for at least one item
check_consistency_of_input_data <- function () {
    foo <- data.frame(item_id = item_id_references, no_of_sellers_who_can_offer_the_whole_quantity = sapply(seq(length(item_id_references)), function (pos) {
        return(nrow(availability[(availability$id == item_id_references[pos]) & (availability$quantity >= r[pos]), ]))
    }))
    foo <- foo[foo$no_of_sellers_who_can_offer_the_whole_quantity == 0,]
    if (nrow(foo) > 0) {
        cat("You should stop, the input data is not consistent and there may be no solution to the problem.\n")
        cat("The following item ids have no availability:\n")
        foo$item_id
    }
}
check_consistency_of_input_data()

# Start assembling the A matrix.

# 1st group of rows (see in the documentation what I call 1st, 2nd etc.)
A1 <- matrix(nrow = N, ncol = 0)
for(x in seq(M)) A1 <- cbind(A1, diag(1, N))
A1 <- cbind(A1, matrix(0, nrow = N, ncol = M))

# 2nd group of rows
A2 <- cbind(diag(1, N * M), matrix(0, nrow = N * M, ncol = M))

# 3rd group of rows
A3 <- matrix(nrow = M, ncol = 0)
for(x in seq(M)) {
    A3 <- cbind(A3, rbind(
        matrix(0, nrow = x - 1, ncol = N),
        matrix(1, nrow = 1, ncol = N),
        matrix(0, nrow = M - x, ncol = N)
    ))
}
A3 <- cbind(A3, diag(-T_, M))

# 4th group of rows
A4 <- matrix(nrow = M, ncol = 0)
for(x in seq(M)) {
    A4 <- cbind(A4, rbind(
        matrix(0, nrow = x - 1, ncol = N),
        prices[x, ],
        matrix(0, nrow = M - x, ncol = N)
    ))
}
A4 <- cbind(A4, diag(-v, M))

# all together now!
A <- rbind(A1, A2, A3, A4)
rm(A1, A2, A3, A4)

solution <- Rsymphony_solve_LP(
    obj = c_,
    mat = A,
    dir = constraints,
    rhs = b,
    max = FALSE,
    types = c(rep("I", N * M), rep("B", M))
)

# make a human-readable version of the solution
output <- data.frame(t(matrix(solution$solution[1:(N*M)], ncol = M)))
# add references to the item ids
colnames(output) <- item_id_references
# add the orders' value
# TODO: there must be a simpler way of doing this
output$totalOrder = sapply(seq(M), function (sellerNo) prices[sellerNo,] %*% t(output[sellerNo,]))
# add references to the seller usernames
output$store <- store_references
# drop sellers from which we are not buying anything
output <- output[output$totalOrder > 0,  ]
write.csv(output, paste0(if (!is.na(args[1])) args[1] else ".simplex", "/output.csv"), row.names = FALSE)

# Save the workspace for further, manual investigation
save.image(paste0(if (!is.na(args[1])) args[1] else ".simplex", "/workspace.RData"))
