### Match/Players Stats and Data

ArenaPro comes with a default database (SQLite), which configures itself automatically. MySQL Database can also be used with ArenaPro!
Currently we are using 3 tables, `arenapro_stats_matches`, `arenapro_stats_maps` and `arenapro_stats_players`.
 
As their names suggest, `arenapro_stats_matches` holds the data of every match, like matchid, team names, scores, etc.
`arenapro_stats_maps` stores data of every map in a match.
Whereas, `arenapro_stats_players` stores data/stats of every player who played in that match. It stores data like matchid, kills, deaths, assists, and other important stats!

### Using MySQL Database with ArenaPro

To use MySQL Database with ArenaPro, open `csgo/cfg/ArenaPro/database.json` file. It's content will be like this:
```json
{
    "DatabaseType": "SQLite",
    "MySqlHost": "your_mysql_host",
    "MySqlDatabase": "your_mysql_database",
    "MySqlUsername": "your_mysql_username",
    "MySqlPassword": "your_mysql_password",
    "MySqlPort": 3306
}
```
Here, change the `DatabaseType` from `SQLite` to `MySQL` and then fill-up all the other details like host, database, username, etc.
MySQL Database is useful for those who wants to use a common database across multiple servers!

### CSV Stats
Once a match is over, data is pulled from the database and a CSV file is written in the folder:
`csgo/ArenaPro_Stats`. This folder will contain CSV file for each match (file name pattern: `match_data_map{mapNumber}_{matchId}.csv`) and it will have the same data which is present in `arenapro_stats_players`.

There is a scope of improvement here, like having the match score in the CSV file or atleast in the file name patter. I'll make this change soon!
