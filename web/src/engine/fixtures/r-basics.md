# R Basics: Vectors and Data Frames

The assignment operator in R is <-, for example x <- 5 stores 5 in x.
c() combines values into a vector, for example c(1, 2, 3).
A data frame is a table where each column is a vector of the same length.
str(df) shows the structure of a data frame, including column types.
head(df) returns the first six rows of a data frame.
summary(df) gives the minimum, quartiles, mean and maximum of each numeric column.
The $ operator selects one column of a data frame, for example df$age.
R indexes vectors starting at 1, not 0.

# Packages and the Tidyverse

install.packages("dplyr") downloads a package from CRAN once.
library(dplyr) loads an installed package into the current session.
filter() keeps the rows of a data frame that match a condition.
select() keeps only the columns you name.
mutate() adds new columns or changes existing ones.
The pipe operator %>% passes the result on its left into the function on its right.
group_by() followed by summarise() computes one summary row per group.
ggplot(df, aes(x = age, y = income)) + geom_point() draws a scatter plot.

# Reading Data and Missing Values

read.csv("file.csv") reads a comma separated file into a data frame.
NA marks a missing value in R.
is.na(x) returns TRUE for every missing value in x.
mean(x, na.rm = TRUE) computes the mean while ignoring missing values.
setwd() changes the working directory, and getwd() prints it.
A factor stores categorical data with a fixed set of levels.
