package com.ems.test;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.ExpectedConditions;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 登录模块 — 等价类 + 边界值（对应 TC-L01~L08）
 */
class LoginTest extends BaseWebTest {

    @Test
    @DisplayName("TC-L03 有效等价类：管理员正确登录")
    void adminLoginSuccess() {
        driver.get(BASE + "/login.html");
        driver.findElement(By.id("username")).sendKeys("root");
        driver.findElement(By.id("password")).sendKeys("123456");
        driver.findElement(By.cssSelector(".login-btn")).click();
        wait.until(ExpectedConditions.urlContains("index.html"));
        WebElement user = driver.findElement(By.id("currentUser"));
        assertTrue(user.getText().contains("管理员"));
    }

    @Test
    @DisplayName("TC-L01 无效等价类：账号为空")
    void emptyUsernameShowsError() {
        driver.get(BASE + "/login.html");
        driver.findElement(By.id("password")).sendKeys("123456");
        driver.findElement(By.cssSelector(".login-btn")).click();
        WebElement err = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("errorMsg")));
        assertEquals("请输入账号", err.getText());
        assertTrue(driver.getCurrentUrl().contains("login.html"));
    }

    @Test
    @DisplayName("TC-L02 无效等价类：密码为空")
    void emptyPasswordShowsError() {
        driver.get(BASE + "/login.html");
        driver.findElement(By.id("username")).sendKeys("root");
        driver.findElement(By.cssSelector(".login-btn")).click();
        WebElement err = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("errorMsg")));
        assertEquals("请输入密码", err.getText());
    }

    @Test
    @DisplayName("TC-L04 无效等价类：密码错误")
    void wrongPasswordShowsError() {
        driver.get(BASE + "/login.html");
        driver.findElement(By.id("username")).sendKeys("root");
        driver.findElement(By.id("password")).sendKeys("wrong");
        driver.findElement(By.cssSelector(".login-btn")).click();
        WebElement err = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("errorMsg")));
        assertTrue(err.getText().contains("错误"));
        assertTrue(driver.getCurrentUrl().contains("login.html"));
    }

    @Test
    @DisplayName("TC-L07 场景法：未登录直接访问主界面应跳转登录")
    void indexRedirectsWhenNotLoggedIn() {
        driver.get(BASE + "/index.html");
        wait.until(ExpectedConditions.urlContains("login.html"));
        assertTrue(driver.getCurrentUrl().contains("login.html"));
    }
}
