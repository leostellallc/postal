Postal: Plotter of Telemetry
============================

Overview
--------

Postal a customizable JavaScript/Dygraph web UI for visualising telemetry. The
backend is written in Python and connects to a MySQL database.

Postal originally stood for Plotter Of Spacecraft Telemetry And Logs, but the
"spacecraft" part was later dropped as the project became more generic.

Setting up
----------

These steps assume the following:
- The host computer is running Ubuntu 18.04;
- The Postal repository is checked out under `/home/www-data/postal`;
- The virtual host is `postal.domain.com`.

1. Install & configure Apache2

Install Apache2 and Python3:

```
sudo apt-get install apache2 python3
```

Update Apache2 configuration to use the new home directory (in
`/etc/apache2/apache2.conf`):

```
<Directory /home/www-data/postal/www>
        Options Indexes FollowSymLinks
        AllowOverride None

        AuthType Basic
        AuthName "Authentication"
        AuthBasicProvider file
        AuthUserFile "/home/www-data/postal/htpasswd"

        Require valid-user
</Directory>

<Directory /home/www-data/postal/www/cgi-bin>
        Options +ExecCGI -Indexes
        AddHandler cgi-script .py
</Directory>
```

Create the local accounts file, and add a guest account:

```
htpasswd -c /home/www-data/postal/htpasswd guest
```

Setup the new site and its document root. Copy
`/etc/apache2/sites-available/000-default.conf` into
`/etc/apache2/sites-available/postal.domain.com.conf`, then add the
following:

```
        ServerName postal.domain.com
        DocumentRoot /home/www-data/postal/www
```

Remove the default CGI configuration, as it is not applicable to us:

```
sudo rm /etc/apache2/conf-available/serve-cgi-bin.conf
```

Enable the new site, enable CGI and restart Apache2:

```
sudo a2dissite 000-default.conf
sudo a2ensite postal.domain.com.conf
sudo a2enmod cgi
sudo service apache2 restart
```

Finally, update Postal configuration with the IP of the host and the URL prefix:
(in `/home/www-data/postal/www/config.js`):

```
const postal_host = "postal.domain.com";
const postal_url = "http://" + postal_host;
```

3. Install & configure MySQL

Install MySQL and the Python3 bindings:

```
sudo apt-get install mysql-server python3-mysqldb
```

Create a base MySQL configuration:

```
sudo mysql_secure_installation utility
[...]
Press y|Y for Yes, any other key for No: No
[...]
Remove anonymous users? (Press y|Y for Yes, any other key for No) : y
[...]
Disallow root login remotely? (Press y|Y for Yes, any other key for No) : No
[...]
Remove test database and access to it? (Press y|Y for Yes, any other key for No) : y
[...]
Reload privilege tables now? (Press y|Y for Yes, any other key for No) : y
```

Create the base tables using the following schema. Update the password as
needed:

```
CREATE USER 'postal'@'localhost' IDENTIFIED BY 'password';

CREATE DATABASE postal;
USE postal;

CREATE TABLE datasets(id INT NOT NULL AUTO_INCREMENT,
                      owner VARCHAR(40),
                      created DATETIME,
                      updated DATETIME,
                      description TEXT,
                      port MEDIUMINT,
                      flags TINYINT,
                      project TEXT,
                      PRIMARY KEY (id));
ALTER TABLE datasets AUTO_INCREMENT = 1000;

CREATE TABLE sharelinks(id VARCHAR(32) NOT NULL,
                        sharedata TEXT,
                        PRIMARY KEY (id));

CREATE TABLE metadata(id INT NOT NULL,
                      metadata TEXT,
                      PRIMARY KEY (id));

GRANT ALL PRIVILEGES ON postal.* TO 'postal'@'localhost';
FLUSH PRIVILEGES;
```

Finally, update the Postal configuration with the host, database and credentials
to MySQL (in `/home/www-data/postal/www/cgi-bin/db.py`):

```
HOST = 'localhost'
USER = 'postal'
PASSWORD = 'password'
DB = 'postal'
```

Customization
-------------

1. Add a logo

Place a logo for the home page under `www/contents/logo.png`.

2. Customize projects, user groups and access control

Postal datasets can be filed under projects. Users can be given access to one or
more projects (or none).

Update Postal's configuration to manage groups (in
`/home/www-data/postal/cgi-bin/www/config.py`):

```
GROUPS = {
    'user1': ['group1', 'group2'],
    'user2': ['group2'],
    'admin': ['admin']
}
```

These "groups" must match the project names for a given dataset for the data to
be accessible (unless a dataset has no project).

To add new projects, customize the `new.html` and `edit.html` files to add the
projects to the drop-down menu. Optionally, customize the `index.html` file to
display projects with different colors (see `get_project_color()`).

The special group `admin` carries all privileges.

3. Create a data importer

Modify `www/cgi-bin/import.py` to support different input data.
